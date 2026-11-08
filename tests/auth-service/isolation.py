"""Validate this CI job's Docker-owned endpoints; never accept arbitrary hosts."""
import ipaddress
import json
import os
import re
import subprocess


IMAGES = {'auth': 'supabase/gotrue:v2.197.0', 'db': 'postgres:17.6'}
PRIVATE_RANGES = tuple(ipaddress.ip_network(cidr) for cidr in
                       ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))
CONTAINER_FORMAT = '''{"id":{{json .Id}},"image":{{json .Config.Image}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"status":{{json .State.Status}},"exit_code":{{json .State.ExitCode}},"networks":{{json .NetworkSettings.Networks}},"bindings":{{json .HostConfig.PortBindings}}}'''
NETWORK_FORMAT = '''{"id":{{json .Id}},"name":{{json .Name}},"driver":{{json .Driver}},"internal":{{json .Internal}},"project":{{json (index .Labels "com.docker.compose.project")}},"network":{{json (index .Labels "com.docker.compose.network")}},"ipam":{{json .IPAM.Config}},"containers":{{json .Containers}}}'''


def project_name():
    if (os.environ.get('CAFE_DISPOSABLE_AUTH') != '1'
            or os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted'):
        raise SystemExit('Actual Auth acceptance requires the isolated GitHub-hosted CI job.')
    run, attempt = os.environ.get('GITHUB_RUN_ID', ''), os.environ.get('GITHUB_RUN_ATTEMPT', '')
    if not re.fullmatch(r'[0-9]+', run) or not re.fullmatch(r'[0-9]+', attempt):
        raise SystemExit('Numeric GitHub run and attempt identifiers are required.')
    return f'cafe-auth-{run}-{attempt}'


def docker(*args):
    # Never consult an environment-selected daemon, context or TLS credentials.
    env = {key: value for key, value in os.environ.items()
           if key not in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')}
    result = subprocess.run(['docker', '--context', 'default', *args], env=env,
                            text=True, capture_output=True, timeout=15)
    if result.returncode:
        raise RuntimeError('Unable to inspect the local disposable Docker project.')
    return result.stdout


def inspect_container(project, service):
    if service not in IMAGES:
        raise ValueError('Unexpected disposable service.')
    ids = docker('ps', '-aq', '--no-trunc', '--filter', f'label=com.docker.compose.project={project}',
                 '--filter', f'label=com.docker.compose.service={service}').split()
    if len(ids) != 1 or not re.fullmatch(r'[0-9a-f]{64}', ids[0]):
        raise RuntimeError('Expected exactly one owned disposable service container.')
    data = json.loads(docker('container', 'inspect', '--format', CONTAINER_FORMAT, ids[0]))
    if (data.get('id') != ids[0] or data.get('project') != project
            or data.get('service') != service or data.get('image') != IMAGES[service]):
        raise RuntimeError('Disposable service ownership/image mismatch.')
    return data


def validate_topology(project, network, containers):
    name = project + '_isolated'
    if (network.get('name') != name or network.get('project') != project
            or network.get('network') != 'isolated' or network.get('driver') != 'bridge'
            or network.get('internal') is not True
            or not re.fullmatch(r'[0-9a-f]{64}', network.get('id', ''))):
        raise RuntimeError('Expected the owned internal-only Docker bridge.')
    if set(containers) != set(IMAGES):
        raise RuntimeError('Expected only the two disposable service containers.')
    subnet_data = network.get('ipam') or []
    ipv4_subnets = [ipaddress.ip_network(item['Subnet']) for item in subnet_data
                    if 'Subnet' in item and ':' not in item['Subnet']]
    if len(ipv4_subnets) != 1 or not any(ipv4_subnets[0].subnet_of(cidr) for cidr in PRIVATE_RANGES):
        raise RuntimeError('Expected one private IPv4 Docker subnet.')
    addresses = {}
    for service, data in containers.items():
        if (data.get('project') != project or data.get('service') != service
                or data.get('image') != IMAGES[service] or data.get('status') != 'running'
                or not re.fullmatch(r'[0-9a-f]{64}', data.get('id', ''))
                or data.get('bindings') or set(data.get('networks') or {}) != {name}):
            raise RuntimeError('Disposable container is not running exclusively on its unexposed internal network.')
        endpoint = data['networks'][name]
        if endpoint.get('NetworkID') != network.get('id'):
            raise RuntimeError('Disposable network identity mismatch.')
        address = ipaddress.ip_address(endpoint.get('IPAddress', ''))
        if (address.version != 4 or address not in ipv4_subnets[0]
                or address in (ipv4_subnets[0].network_address, ipv4_subnets[0].broadcast_address)):
            raise RuntimeError('Unexpected disposable container address.')
        addresses[service] = str(address)
    if addresses['auth'] == addresses['db']:
        raise RuntimeError('Disposable service addresses must be distinct.')
    if set(network.get('containers') or {}) != {data['id'] for data in containers.values()}:
        raise RuntimeError('Unexpected container attached to the disposable network.')
    for service, data in containers.items():
        member = network['containers'][data['id']]
        if member.get('IPv4Address') != f"{addresses[service]}/{ipv4_subnets[0].prefixlen}":
            raise RuntimeError('Disposable endpoint address differs between container and network metadata.')
    return addresses


def discover_endpoints():
    project = project_name()
    containers = {service: inspect_container(project, service) for service in IMAGES}
    network = json.loads(docker('network', 'inspect', '--format', NETWORK_FORMAT, project + '_isolated'))
    addresses = validate_topology(project, network, containers)
    print('PASS disposable Docker topology: two owned services, internal bridge, no published ports')
    return addresses


def startup_events(raw):
    """Convert untrusted logs to fixed event names and bounded numeric fields."""
    events = []
    for line in raw[-262144:].splitlines():
        try:
            entry = json.loads(line)
        except (ValueError, TypeError):
            continue
        if not isinstance(entry, dict):
            continue
        message = entry.get('msg')
        if not isinstance(message, str):
            continue
        if message == 'GoTrue migrations applied successfully':
            event = {'event': 'auth_migrations_applied'}
            count = entry.get('count')
            if isinstance(count, int) and not isinstance(count, bool) and 0 <= count <= 10000:
                event['count'] = count
            events.append(event)
        elif re.fullmatch(r'GoTrue API started on: (?:0\.0\.0\.0|127\.0\.0\.1|\[::\]):[0-9]{1,5}', message):
            port = int(message.rsplit(':', 1)[1])
            if 1 <= port <= 65535:
                events.append({'event': 'auth_api_listening', 'port': port})
        elif message.lower().startswith(('unable to load config', 'failed to load configuration')):
            events.append({'event': 'auth_configuration_failure'})
        elif message.startswith('error opening database:'):
            events.append({'event': 'auth_database_connection_failure'})
        elif 'running db migrations' in message and entry.get('level') in ('error', 'fatal', 'panic'):
            events.append({'event': 'auth_migration_failure'})
        elif entry.get('level') in ('error', 'fatal', 'panic'):
            events.append({'event': 'auth_error_details_withheld'})
    return events[-12:]


def diagnostics():
    project = project_name()
    for service in IMAGES:
        try:
            data = inspect_container(project, service)
            state = data.get('status')
            if state not in ('created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'):
                state = 'unknown'
            code = data.get('exit_code')
            code = code if isinstance(code, int) and 0 <= code <= 255 else None
            print(json.dumps({'service': service, 'state': state, 'exit_code': code,
                              'network_count': len(data.get('networks') or {}),
                              'has_published_bindings': bool(data.get('bindings'))}))
            if service == 'auth':
                # Docker logs places service stderr on its own stderr; read both
                # privately, then emit only fixed classifications, never raw text.
                env = {key: value for key, value in os.environ.items()
                       if key not in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')}
                logs = subprocess.run(['docker', '--context', 'default', 'logs', '--tail', '200', data['id']],
                                      env=env, text=True, capture_output=True, timeout=10)
                for event in startup_events(logs.stdout + '\n' + logs.stderr):
                    print(json.dumps(event, sort_keys=True))
        except (RuntimeError, ValueError, subprocess.TimeoutExpired):
            print(json.dumps({'service': service, 'event': 'diagnostics_unavailable'}))


if __name__ == '__main__':
    diagnostics()

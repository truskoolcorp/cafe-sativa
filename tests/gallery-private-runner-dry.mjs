// Dry preflight only. Does not provision, read credential values, start Docker
// containers, contact Stripe, or open a webhook. Run without any Stripe secret.
import {spawnSync} from 'node:child_process'
import {existsSync,lstatSync,readdirSync,realpathSync} from 'node:fs'
import {join} from 'node:path'
import {createServer} from 'node:net'

const reviewedGuard='3ca2cd6931e05d89ca7a64772529a52ff8d59ca2'
const forbiddenVar=/^(?:STRIPE_|SUPABASE_|NEXT_PUBLIC_SUPABASE(?:_|$)|VERCEL(?:_|$)|GALLERY_TEST_STRIPE_|DOCKER_HOST$|DOCKER_CONTEXT$|DOCKER_TLS|DOCKER_CERT_PATH$)/
const safeEnv = {PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C'}
let stage='input and clean environment'
const check=x=>{if(!x)throw Error('dry prerequisite missing')}
const run=(cmd,args)=>{
 const r=spawnSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:65536,timeout:5000,env:safeEnv})
 if(r.status!==0)throw Error('local command unavailable')
 return r.stdout.trim()
}
const reachablePort=port=>new Promise((resolve,reject)=>{
 const server=createServer()
 server.once('error',reject)
 server.listen({port,host:'127.0.0.1',exclusive:true},()=>{server.close(err=>err?reject(err):resolve())})
})
try{
 const expected=process.argv[2]
 check(process.argv.length===3&&/^[a-f0-9]{40}$/.test(expected??''))
 check(!Object.keys(process.env).some(key=>forbiddenVar.test(key)))
 check(process.env.GITHUB_ACTIONS!=='true') // no authorization to put secrets into a public runner
 check(Number(process.versions.node.split('.')[0])>=24)
 stage='exact reviewed checkout and no dotenv import'
 check(run('git',['rev-parse','HEAD'])===expected)
 run('git',['merge-base','--is-ancestor',reviewedGuard,expected])
 check(run('git',['status','--porcelain','--untracked-files=normal'])==='')
 check(!readdirSync('.').some(name=>/^\.env(?:$|\.)/.test(name)&&!/^\.env\.(?:example|sample|template)$/.test(name)))
 console.log('PASS: exact clean local checkout and no dotenv or provider key inputs.')
 stage='verified local Docker engine only'
 const endpoint=run('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}'])
 check(/^unix:\/\/\/[^\n]+$/.test(endpoint))
 const socket=realpathSync(endpoint.slice('unix://'.length))
 const localSockets=['/var/run/docker.sock','/run/docker.sock',join(safeEnv.HOME??'/no-home','.docker/run/docker.sock')]
 check(localSockets.some(p=>existsSync(p)&&realpathSync(p)===socket)&&lstatSync(socket).isSocket())
 check(run('docker',['--host','unix://'+socket,'version','--format','{{.Server.Version}}']).length>0)
 console.log('PASS: recognized local Unix Docker socket; no remote context.')
 stage='unused local application, Supabase API and database ports'
 for(const port of [4116,54321,54322])await reachablePort(port)
 console.log('PASS: all three expected loopback ports are unused.')
 console.log('PASS: dry readiness only. No credential, approval, sandbox, transaction or document was requested or created.')
}catch{
 console.error('Gallery private runner blocked at: '+stage+'. No raw diagnostics emitted.')
 process.exitCode=1
}

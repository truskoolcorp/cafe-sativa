FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN groupadd --gid 10001 voice && useradd --uid 10001 --gid 10001 --create-home voice
COPY requirements.txt ./
RUN python -m pip install --disable-pip-version-check --no-cache-dir -r requirements.txt
COPY agent.py core.py dialogue.py turns.py ./
USER 10001:10001
CMD ["python", "agent.py", "start"]

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agent.py memory.py preflight.py ./
RUN CS_LIVEKIT_AGENT_NAME=cafe-sativa-hosts python agent.py download-files
CMD ["sh", "-c", "python preflight.py && exec python agent.py start"]

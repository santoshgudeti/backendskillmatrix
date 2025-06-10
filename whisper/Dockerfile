FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg && apt-get clean

COPY whisper_service.py requirements.txt ./
COPY ../.env .env  

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 5001

CMD ["python", "whisper_service.py"]

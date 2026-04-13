FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app

RUN apk add --no-cache \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-kor \
    unzip \
 && npm install -g @google/gemini-cli@latest \
 && mkdir -p /root/.gemini

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 4000
CMD ["npm", "run", "start"]

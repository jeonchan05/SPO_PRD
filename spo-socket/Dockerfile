FROM public.ecr.aws/docker/library/node:20-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 4100
CMD ["npm", "run", "start"]

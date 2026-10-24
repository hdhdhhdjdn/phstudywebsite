# 错题站 · Docker 镜像
# 构建：docker build -t cuoti .
# 运行：docker run -d --name cuoti -p 8765:8765 \
#         -e REGISTER_CODE=你的邀请码 \
#         -v $(pwd)/cloud-data:/app/cloud-data \
#         cuoti
FROM node:20-alpine

WORKDIR /app

COPY cloud-server.js index.html login.html ./
COPY css ./css
COPY js ./js

ENV PORT=8765 \
    HOST=0.0.0.0

RUN mkdir -p /app/cloud-data/uploads

EXPOSE 8765
VOLUME ["/app/cloud-data"]

CMD ["node", "cloud-server.js"]

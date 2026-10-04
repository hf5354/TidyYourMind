# TidyYourMind 網頁版 — Docker 部署
FROM node:20-slim

WORKDIR /app

# 後端 dependencies
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev

# 程式碼
COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 注意：所有 secret 經環境變數傳入，唔好 bake 入 image
CMD ["node", "backend/server.js"]

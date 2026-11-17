FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY erp ./erp
COPY collector ./collector
COPY --from=agent_ui rules.html rules.css rules.js ./ui/
USER node
CMD ["node", "erp/server.mjs"]

FROM node:12

COPY "./package.json" "./tsconfig.json" "./yarn.lock" ./

RUN yarn install

COPY  "./src/" "./src/"

COPY "./*.js" "./"
COPY "./.env" "./.env"

CMD sleep infinity
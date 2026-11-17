import {randomBytes} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {networkInterfaces} from 'node:os';
const root=resolve(import.meta.dirname,'..');
if(!existsSync(resolve(root,'.env'))){
 const password=randomBytes(24).toString('hex');
 const localAddresses=Object.values(networkInterfaces()).flat().filter(info=>info&&info.family==='IPv4'&&!info.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(info.address)).map(info=>`http://${info.address}:8080`);
 writeFileSync(resolve(root,'.env'),`DATABASE_URL=postgresql://uzbite:${password}@127.0.0.1:5432/uzbite?schema=public\nREDIS_URL=redis://127.0.0.1:6379\nJWT_SECRET=${randomBytes(48).toString('hex')}\nJWT_REFRESH_SECRET=${randomBytes(48).toString('hex')}\nPORT=8081\nNODE_ENV=development\nALLOWED_ORIGINS=${['http://localhost:8080','http://127.0.0.1:8080','http://localhost:8082','http://127.0.0.1:8082',...localAddresses].join(',')}\n`);
 console.log('Created ignored local .env with random credentials.');
}
mkdirSync(resolve(root,'apps/frontend'),{recursive:true});
// The supplied browser key is copied locally, never committed or printed.
const attachment=process.env.UZBITE_SPEC_PATH;
if(attachment&&!existsSync(resolve(root,'apps/frontend/.env'))){
 const key=readFileSync(attachment,'utf8').match(/VITE_YANDEX_MAPS_API_KEY=([a-zA-Z0-9-]+)/)?.[1];
 if(key)writeFileSync(resolve(root,'apps/frontend/.env'),`VITE_YANDEX_MAPS_API_KEY=${key}\n`);
}
console.log('Local configuration ready. Run npm run db:local, then db:migrate and db:seed.');

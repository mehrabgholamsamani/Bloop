import argon2 from 'argon2';

const password = process.argv[2];
if (!password) throw new Error('Usage: pnpm --filter @chatroom/server password:hash <password>');
console.log(await argon2.hash(password, { type: argon2.argon2id }));

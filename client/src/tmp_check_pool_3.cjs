const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_xtTurX3H1RKf@ep-ancient-mode-anfhme7z-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

async function run() {
  await client.connect();
  const settlementsRes = await client.query("SELECT * FROM settlements WHERE month = '2026-03' AND status = 'paid'");
  const settlements = settlementsRes.rows;
  
  const usersRes = await client.query('SELECT * FROM users');
  const users = usersRes.rows;
  
  console.log('SETTLEMENTS:');
  settlements.forEach(s => {
      let fromU = users.find(u=>u.id===s.from_user)?.name;
      let toU = users.find(u=>u.id===s.to_user)?.name;
      console.log(`${fromU} paid ${toU} ${s.amount}`);
  });
  
  await client.end();
}
run().catch(console.error);

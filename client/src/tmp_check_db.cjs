const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_xtTurX3H1RKf@ep-ancient-mode-anfhme7z-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

async function run() {
  await client.connect();
  // Using typical month '2026-04'
  const res = await client.query("SELECT * FROM expenses WHERE month = '2026-04'");
  const expenses = res.rows;
  
  const usersRes = await client.query('SELECT * FROM users');
  const users = usersRes.rows;
  
  let ganesh = users.find(u => u.name.toLowerCase().includes('ganesh'));
  if (!ganesh) ganesh = users[0];
  console.log('User:', ganesh.name);

  // Pairwise net processing
  let debts = {};
  expenses.forEach(e => {
    let splits = e.splits;
    if (typeof splits === 'string') splits = JSON.parse(splits);
    
    splits.forEach(s => {
      if (s.userId !== e.paid_by) {
        if (!debts[s.userId]) debts[s.userId] = {};
        debts[s.userId][e.paid_by] = (debts[s.userId][e.paid_by] || 0) + s.amount;
      }
    });
  });

  let pairwiseIOweThem = 0;
  let pairwiseTheyOweMe = 0;
  users.forEach(u => {
    if (u.id === ganesh.id) return;
    const iOweThemRaw = (debts[ganesh.id] && debts[ganesh.id][u.id]) || 0;
    const theyOweMeRaw = (debts[u.id] && debts[u.id][ganesh.id]) || 0;
    
    const net = theyOweMeRaw - iOweThemRaw;
    if (net > 0.01) pairwiseTheyOweMe += net;
    else if (net < -0.01) pairwiseIOweThem += Math.abs(net);
  });
  console.log('--- PAIRWISE LOGIC ---');
  console.log('Pairwise IOweThem (To Pay):', pairwiseIOweThem);
  console.log('Pairwise TheyOweMe (To Receive):', pairwiseTheyOweMe);

  let totalPaid = 0;
  let totalShare = 0;
  expenses.forEach(e => {
    if (e.paid_by === ganesh.id) totalPaid += Number(e.amount);
    let splits = e.splits;
    if (typeof splits === 'string') splits = JSON.parse(splits);
    let gSplit = splits.find(s => s.userId === ganesh.id);
    if (gSplit) totalShare += Number(gSplit.amount);
  });
  console.log('--- DASHBOARD LOGIC ---');
  console.log('Dashboard Paid:', totalPaid);
  console.log('Dashboard Share:', totalShare);
  console.log('Dashboard Net:', totalPaid - totalShare);

  await client.end();
}
run().catch(console.error);

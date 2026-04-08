const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_xtTurX3H1RKf@ep-ancient-mode-anfhme7z-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

async function run() {
  await client.connect();
  const res = await client.query("SELECT * FROM expenses WHERE month = '2026-03'");
  const expenses = res.rows;
  
  const usersRes = await client.query('SELECT * FROM users');
  const users = usersRes.rows;
  
  const settlementsRes = await client.query("SELECT * FROM settlements WHERE month = '2026-03' AND status = 'paid'");
  const settlements = settlementsRes.rows;

  const userNetBalances = {};
  users.forEach(u => { userNetBalances[u.id] = 0; });

  expenses.forEach(expense => {
    if (userNetBalances[expense.paid_by] !== undefined) {
      userNetBalances[expense.paid_by] += Number(expense.amount);
    }
    let splits = expense.splits;
    if (typeof splits === 'string') splits = JSON.parse(splits);
    
    splits.forEach(split => {
      if (userNetBalances[split.userId] !== undefined) {
        userNetBalances[split.userId] -= Number(split.amount);
      }
    });

  });

  const kiranId = users.find(u=>u.name==='Kiran').id;
  const ganeshId = users.find(u=>u.name==='Ganesh').id;

  console.log("Kiran Gross Debt (from expenses):", Math.abs(userNetBalances[kiranId]));
  console.log("Ganesh Gross Receivable (from expenses):", Math.abs(userNetBalances[ganeshId]));

  settlements.forEach(s => {
    if (userNetBalances[s.from_user] !== undefined) userNetBalances[s.from_user] += Number(s.amount);
    if (userNetBalances[s.to_user] !== undefined) userNetBalances[s.to_user] -= Number(s.amount);
  });

  console.log("Kiran Net Debt (after settlements):", Math.abs(userNetBalances[kiranId]));
  console.log("Ganesh Net Receivable (after settlements):", Math.abs(userNetBalances[ganeshId]));

  await client.end();
}
run().catch(console.error);

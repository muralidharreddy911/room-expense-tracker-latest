const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_xtTurX3H1RKf@ep-ancient-mode-anfhme7z-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

async function run() {
  await client.connect();
  const res = await client.query("SELECT * FROM expenses WHERE month = '2026-03'"); // Using March
  const expenses = res.rows.length > 0 ? res.rows : (await client.query("SELECT * FROM expenses")).rows;
  
  const usersRes = await client.query('SELECT * FROM users');
  const users = usersRes.rows;
  
  console.log('Expenses:', expenses.length, 'Users:', users.length);

  // 1. Calculate net balances
  const userNetBalances = {};
  users.forEach(u => { userNetBalances[u.name] = 0; });

  let rawTotalPaid = 0;
  let rawTotalShare = 0;

  expenses.forEach(expense => {
    let paidBy = users.find(u => u.id === expense.paid_by)?.name;
    if (userNetBalances[paidBy] !== undefined) {
      userNetBalances[paidBy] += Number(expense.amount);
      rawTotalPaid += Number(expense.amount);
    }
    let splits = expense.splits;
    if (typeof splits === 'string') splits = JSON.parse(splits);
    
    splits.forEach(split => {
      let splitUser = users.find(u => u.id === split.userId)?.name;
      if (userNetBalances[splitUser] !== undefined) {
        userNetBalances[splitUser] -= Number(split.amount);
        rawTotalShare += Number(split.amount);
      }
    });
  });

  console.log('GLOBAL: Total Paid:', rawTotalPaid, 'Total Share:', rawTotalShare);

  const debtors = Object.keys(userNetBalances).map(n => ({ name: n, balance: userNetBalances[n] })).filter(u => u.balance < -0.01);
  const creditors = Object.keys(userNetBalances).map(n => ({ name: n, balance: userNetBalances[n] })).filter(u => u.balance > 0.01);

  let totalDebts = debtors.reduce((s, d) => s + d.balance, 0);
  let totalCredits = creditors.reduce((s, c) => s + c.balance, 0);
  
  console.log('Sum Debtors:', totalDebts);
  console.log('Sum Creditors:', totalCredits);
  
  console.log('\n--- DEBTORS (should pay) ---');
  debtors.sort((a,b) => a.balance - b.balance).forEach(d => console.log(d.name, d.balance));
  
  console.log('\n--- CREDITORS (should receive) ---');
  creditors.sort((a,b) => b.balance - a.balance).forEach(c => console.log(c.name, c.balance));

  await client.end();
}
run().catch(console.error);

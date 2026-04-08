const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://neondb_owner:npg_xtTurX3H1RKf@ep-ancient-mode-anfhme7z-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

async function run() {
  await client.connect();
  await client.query(`
    WITH ranked AS (
      SELECT id,
        ROW_NUMBER() OVER (PARTITION BY month ORDER BY created_at ASC NULLS LAST) AS new_sn
      FROM expenses
    )
    UPDATE expenses
    SET serial_no = ranked.new_sn
    FROM ranked
    WHERE expenses.id = ranked.id
  `);
  console.log('Serial numbers reset scoped to months!');
  await client.end();
}
run().catch(console.error);

const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  connectionString: 'postgresql://readonly_user_pusu:sdvfcwerfg34ergfer@10.7.9.42:5432/dev_pusula_simulation_db'
});

async function run() {
  await client.connect();

  const data = JSON.parse(fs.readFileSync('../simulation_v2.sqlnb', 'utf8'));
  const uf = data.cells.find(c => c.name === 'unified_flow');

  console.log('=== DROP + CREATE unified_flow view ===');
  try {
    await client.query('DROP VIEW IF EXISTS public.unified_flow CASCADE');
    console.log('✅ Dropped old view');

    await client.query(`CREATE VIEW public.unified_flow AS\n${uf.content}`);
    console.log('✅ Created new view');

    // Verify
    const res = await client.query(`SELECT * FROM public.unified_flow LIMIT 1`);
    const cols = res.fields.map(f => f.name);
    console.log('\nColumns:', cols.join(', '));
    console.log(`Has wait_time_unified: ${cols.includes('wait_time_unified') ? '❌' : '✅ NO'}`);

    const count = await client.query('SELECT count(*) FROM public.unified_flow');
    console.log(`Rows: ${count.rows[0].count}`);
  } catch (err) {
    console.log(`❌ FAILED: ${err.message}`);
  }

  await client.end();
}

run().catch(err => console.error(err));

// Phase 0 原型 API 级 E2E 自验脚本
const BASE = 'http://localhost:3100';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS ${name}`);
  else { console.log(`  FAIL ${name} ${detail}`); failures++; }
}

async function api(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function pollJob(id, sessionId, want, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { data } = await api(`/api/edit-jobs/${id}?session_id=${sessionId}`);
    if (want.includes(data.job.status)) return data.job;
    await sleep(1000);
  }
  return null;
}

(async () => {
  console.log('== 1. 新会话获赠 30 点 ==');
  let r = await api('/api/projects', { method: 'POST', body: JSON.stringify({ title: 'e2e' }) });
  check('create project 200', r.status === 200, JSON.stringify(r.data).slice(0, 120));
  const sessionId = r.data.session_id;
  const projectId = r.data.project.id;
  check('balance 30', r.data.balance === 30, `balance=${r.data.balance}`);

  console.log('== 2. 样板 asset + 选区 ==');
  r = await api('/api/assets', { method: 'POST', body: JSON.stringify({ project_id: projectId, session_id: sessionId, kind: 'sample', uri: '/samples/room-a.jpg' }) });
  check('create asset', r.status === 200);
  const assetId = r.data.asset.id;
  r = await api('/api/selections', { method: 'POST', body: JSON.stringify({ asset_id: assetId, session_id: sessionId, hotspot_id: 'room-a-sofa', project_id: projectId }) });
  check('create selection', r.status === 200 && r.data.selection.label === '沙发', JSON.stringify(r.data).slice(0, 160));
  const selectionId = r.data.selection.id;

  console.log('== 3. 提交任务 + 幂等 ==');
  const idem1 = 'e2e-idem-1';
  r = await api('/api/edit-jobs', { method: 'POST', body: JSON.stringify({ selection_id: selectionId, session_id: sessionId, hotspot_id: 'room-a-sofa', prompt: '换成浅色布艺沙发', prompt_type: 'quick', idempotency_key: idem1 }) });
  check('submit 200 created', r.status === 200 && r.data.created === true);
  check('balance 25 after charge', r.data.balance === 25, `balance=${r.data.balance}`);
  const jobId1 = r.data.job.id;
  check('job charged', r.data.job.status === 'charged');

  r = await api('/api/edit-jobs', { method: 'POST', body: JSON.stringify({ selection_id: selectionId, session_id: sessionId, hotspot_id: 'room-a-sofa', prompt: '换成浅色布艺沙发', prompt_type: 'quick', idempotency_key: idem1 }) });
  check('duplicate idem deduped', r.status === 200 && r.data.deduped === true && r.data.job.id === jobId1);
  check('no double charge', r.data.balance === 25, `balance=${r.data.balance}`);

  console.log('== 4. 状态流转 → succeeded ==');
  const job1 = await pollJob(jobId1, sessionId, ['succeeded', 'failed', 'refunded']);
  check('job succeeded', !!job1 && job1.status === 'succeeded', `status=${job1?.status}`);
  check('result uri set', !!job1?.result_uri, `uri=${job1?.result_uri}`);
  check('actual_ai_cost 0', job1?.actual_ai_cost === 0);
  check('latency recorded', typeof job1?.latency_ms === 'number' && job1.latency_ms > 0);

  console.log('== 5. 账本一致 ==');
  r = await api(`/api/points/ledger?session_id=${sessionId}`);
  const sum = r.data.entries.reduce((a, e) => a + e.delta, 0);
  check('ledger sum == balance', sum === r.data.balance, `sum=${sum} balance=${r.data.balance}`);
  check('has grant + charge', r.data.entries.some((e) => e.reason === 'grant_new_session' && e.delta === 30) && r.data.entries.some((e) => e.reason === 'charge' && e.delta === -5));

  console.log('== 6. 强制失败 → 自动退点 ==');
  const idem2 = 'e2e-idem-2';
  r = await api('/api/edit-jobs', { method: 'POST', body: JSON.stringify({ selection_id: selectionId, session_id: sessionId, hotspot_id: 'room-a-sofa', prompt: '换成深灰色皮质沙发', prompt_type: 'quick', idempotency_key: idem2, force_fail: 'error' }) });
  check('fail-job submitted', r.status === 200 && r.data.created);
  check('balance 20 after 2nd charge', r.data.balance === 20, `balance=${r.data.balance}`);
  const jobId2 = r.data.job.id;
  const job2failed = await pollJob(jobId2, sessionId, ['failed', 'refunded']);
  check('job reached failed', !!job2failed && ['failed', 'refunded'].includes(job2failed.status), `status=${job2failed?.status}`);
  const job2 = await pollJob(jobId2, sessionId, ['refunded']);
  check('auto refunded', !!job2 && job2.status === 'refunded', `status=${job2?.status}`);
  r = await api(`/api/points/ledger?session_id=${sessionId}`);
  const sum2 = r.data.entries.reduce((a, e) => a + e.delta, 0);
  check('refund entry +5', r.data.entries.some((e) => e.reason === 'refund' && e.delta === 5 && e.job_id === jobId2));
  check('balance back to 25', r.data.balance === 25 && sum2 === 25, `balance=${r.data.balance} sum=${sum2}`);

  console.log('== 7. 异常输入 ==');
  r = await api('/api/edit-jobs', { method: 'POST', body: JSON.stringify({ selection_id: selectionId, session_id: sessionId, hotspot_id: 'room-a-sofa', prompt: '   ', prompt_type: 'text', idempotency_key: 'e2e-empty' }) });
  check('empty prompt 400', r.status === 400 && r.data.error === 'invalid_prompt');
  r = await api('/api/edit-jobs', { method: 'POST', body: JSON.stringify({ selection_id: selectionId, session_id: sessionId, hotspot_id: 'room-a-sofa', prompt: 'x'.repeat(201), prompt_type: 'text', idempotency_key: 'e2e-long' }) });
  check('long prompt 400', r.status === 400 && r.data.error === 'invalid_prompt');
  r = await api('/api/edit-jobs', { method: 'POST', body: JSON.stringify({ selection_id: 'no-such', session_id: sessionId, hotspot_id: 'room-a-sofa', prompt: '换沙发', prompt_type: 'text', idempotency_key: 'e2e-nosel' }) });
  check('bad selection 400', r.status === 400 && r.data.error === 'no_selection');

  console.log('== 8. 点数不足 402 ==');
  // 当前余额 25，再成功 5 次扣到 0
  for (let i = 0; i < 5; i++) {
    const rr = await api('/api/edit-jobs', { method: 'POST', body: JSON.stringify({ selection_id: selectionId, session_id: sessionId, hotspot_id: 'room-a-sofa', prompt: '换成浅色布艺沙发', prompt_type: 'quick', idempotency_key: `e2e-drain-${i}` }) });
    if (rr.status !== 200) { check(`drain ${i} ok`, false, `status=${rr.status}`); break; }
    await pollJob(rr.data.job.id, sessionId, ['succeeded', 'failed', 'refunded']);
    if (i === 4) check('5 drains ok', true);
  }
  r = await api(`/api/points/ledger?session_id=${sessionId}`);
  check('balance 0', r.data.balance === 0, `balance=${r.data.balance}`);
  r = await api('/api/edit-jobs', { method: 'POST', body: JSON.stringify({ selection_id: selectionId, session_id: sessionId, hotspot_id: 'room-a-sofa', prompt: '换成浅色布艺沙发', prompt_type: 'quick', idempotency_key: 'e2e-poor' }) });
  check('insufficient 402', r.status === 402 && r.data.error === 'insufficient_points');

  console.log('== 9. 埋点完整性 ==');
  r = await api(`/api/events?session_id=${sessionId}`);
  const names = r.data.events.map((e) => e.name);
  for (const n of ['demo_started', 'asset_ready', 'selection_confirmed', 'edit_submitted', 'edit_completed', 'edit_failed']) {
    check(`event ${n}`, names.includes(n), names.join(','));
  }
  const submitted = r.data.events.find((e) => e.name === 'edit_submitted');
  check('edit_submitted props', !!submitted?.props && submitted.props.points === 5 && 'prompt_type' in submitted.props && !('prompt' in (submitted.props || {})));
  const failed = r.data.events.find((e) => e.name === 'edit_failed');
  check('edit_failed props', !!failed?.props && failed.props.error_class === 'mock_error' && failed.props.refunded === true);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(2); });

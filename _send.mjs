const TOKEN = 'ExponentPushToken[S11eNyOqAi7-5GTd1jvCLy]';
const send = await fetch('https://exp.host/--/api/v2/push/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify([{
    to: TOKEN,
    title: 'Sintherior',
    body: 'Backgrounded test — this should appear in the tray.',
    sound: 'default',
    channelId: 'default',
    priority: 'high',
    data: { kind: 'push-test' },
  }]),
});
const sent = await send.json();
const ticket = sent?.data?.[0];
console.log('TICKET:', JSON.stringify(ticket));
if (ticket?.status !== 'ok') process.exit(1);
await new Promise((r) => setTimeout(r, 7000));
const rec = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ ids: [ticket.id] }),
});
console.log('RECEIPT:', JSON.stringify((await rec.json())?.data ?? {}));

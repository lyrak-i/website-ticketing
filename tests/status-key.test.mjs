import test from 'node:test';
import assert from 'node:assert/strict';

const STATUS_LABEL = {
  idle: 'Idle',
  belum_otw: 'Belum OTW',
  otw: 'OTW to Site',
  waiting_onsite: 'Waiting Onsite',
  onsite: 'Onsite',
  waiting_selesai: 'Waiting Selesai',
  selesai: 'Selesai'
};
const STATUS_KEY = {
  idle: 'idle',
  'belum otw': 'belum_otw',
  'otw to site': 'otw',
  selesai: 'selesai'
};

function statusKey(value) {
  const v = String(value ?? '').trim();
  if (STATUS_LABEL[v]) return v;
  return STATUS_KEY[v.toLowerCase()] || 'idle';
}

test('statusKey maps sheet label', () => {
  assert.equal(statusKey('Belum OTW'), 'belum_otw');
  assert.equal(statusKey('OTW to Site'), 'otw');
  assert.equal(statusKey('Selesai'), 'selesai');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTimes } from '../src/lib/activity-matcher.js';

test('status pair parent menjadi prioritas dan tidak membuka sub issue', () => {
  const url='https://github.com/GO-Bimbel/service/issues/1';
  const result=decideTimes({ticketUrl:url,date:'2026-09-08',session:'11:00'}, {
    [url]:{url,linkedUrls:['https://github.com/GO-Bimbel/service/issues/2'],events:[
      {datetime:'2026-09-08T02:15:00Z',type:'status',text:'changed status to In Progress'},
      {datetime:'2026-09-08T04:00:00Z',type:'status',text:'changed status to Ready to Review'}
    ]}
  });
  assert.equal(result.rule,'PARENT_STATUS_PAIR');
  assert.equal(result.hours,1.75);
  assert.equal(result.confidence,'HIGH');
});

test('end activity GitHub memakai fallback DSM jika start tidak ditemukan', () => {
  const url='https://github.com/GO-Bimbel/service/issues/1';
  const child='https://github.com/GO-Bimbel/service/issues/2';
  const result=decideTimes({ticketUrl:url,date:'2026-09-08',session:'16:00'}, {
    [url]:{url,linkedUrls:[child],events:[]},
    [child]:{url:child,events:[{datetime:'2026-09-08T08:30:00Z',type:'pull_request',text:'opened pull request for review'}]}
  });
  assert.equal(result.rule,'DSM_FALLBACK_GITHUB_END');
  assert.match(result.start,/13:00:00/);
  assert.equal(result.endSource,child);
});

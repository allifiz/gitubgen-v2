import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTimes } from '../src/lib/activity-matcher.js';

test('status pair parent menjadi prioritas dan jam efektif dipakai', () => {
  const url='https://github.com/GO-Bimbel/service/issues/1';
  const result=decideTimes({ticketUrl:url,date:'2026-09-08',session:'11:00',status:'ready to review'}, {
    [url]:{url,linkedUrls:['https://github.com/GO-Bimbel/service/issues/2'],events:[
      {datetime:'2026-09-08T02:15:00Z',type:'status',text:'changed status to In Progress'},
      {datetime:'2026-09-08T04:00:00Z',type:'status',text:'changed status to Ready to Review'}
    ]}
  });
  assert.equal(result.rule,'PARENT_START_MATCHED_END');
  assert.equal(result.hours,1.75);
  assert.equal(result.confidence,'HIGH');
});

test('end activity linked memakai fallback DSM jika start tidak ditemukan', () => {
  const url='https://github.com/GO-Bimbel/service/issues/1';
  const child='https://github.com/GO-Bimbel/service/issues/2';
  const result=decideTimes({ticketUrl:url,date:'2026-09-08',session:'16:00'}, {
    [url]:{url,linkedUrls:[child],events:[]},
    [child]:{url:child,events:[{datetime:'2026-09-08T08:30:00Z',type:'pull_request',text:'opened pull request for review'}]}
  });
  assert.equal(result.rule,'DSM_FALLBACK_MATCHED_GITHUB_END');
  assert.match(result.start,/13:00:00/);
  assert.equal(result.endSource,child);
});

test('Todo adalah start valid dan Ready to Review adalah end', () => {
  const url='https://github.com/GO-Bimbel/gotim/issues/877';
  const result=decideTimes({ticketUrl:url,date:'2026-09-02',session:'16:00',status:'ready to review'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-09-02T08:50:56Z',type:'status',text:'moved this to Todo in BE-TASK'},
      {datetime:'2026-09-02T09:42:10Z',type:'status',text:'moved this from Todo to Ready to Review in BE-TASK'}
    ]}
  });
  assert.equal(result.rule,'PARENT_START_MATCHED_END');
  assert.equal(result.start,'2026-09-02T08:50:56Z');
  assert.equal(result.end,'2026-09-02T09:42:10Z');
  assert.equal(Number(result.hours.toFixed(2)),0.85);
});

test('jam efektif memotong istirahat satu jam', () => {
  const url='https://github.com/GO-Bimbel/gotim/issues/877';
  const result=decideTimes({ticketUrl:url,date:'2026-09-03',session:'11:00',status:'staging'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-09-03T09:03:05Z',type:'status',text:'moved this from Ready to Review to Staging in BE-TASK'}
    ]}
  });
  assert.match(result.start,/09:00:00/);
  assert.equal(Number(result.hours.toFixed(2)),6.05);
});

test('tidak memakai mention atau assign sebagai end', () => {
  const url='https://github.com/GO-Bimbel/service/issues/1';
  const result=decideTimes({ticketUrl:url,date:'2026-09-03',session:'11:00',status:'staging'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-09-03T03:00:00Z',type:'activity',text:'mentioned this in 2 issues'},
      {datetime:'2026-09-03T04:00:00Z',type:'activity',text:'assigned allifgobimbel'}
    ]}
  });
  assert.equal(result.rule,'NEEDS_REVIEW_NO_VALID_END');
  assert.equal(result.end,null);
});

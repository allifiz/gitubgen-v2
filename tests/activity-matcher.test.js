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

test('PR linked pada parent adalah end valid bila status target tidak tercatat', () => {
  const url='https://github.com/GO-Bimbel/db-go/issues/2799';
  const result=decideTimes({ticketUrl:url,date:'2026-09-01',session:'11:00',status:'staging'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-09-01T02:27:04Z',type:'pull_request',text:'allifgobimbel linked a pull request that will close this issue #2801'}
    ]}
  });
  assert.match(result.start,/09:00:00/);
  assert.equal(result.end,'2026-09-01T02:27:04Z');
  assert.equal(result.endSourceKind,'parent');
});

test('durasi beberapa detik tetap valid dan tidak dipanjangkan', () => {
  const url='https://github.com/GO-Bimbel/db-go/issues/2879';
  const result=decideTimes({ticketUrl:url,date:'2026-09-30',session:'11:00',status:'deployed'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-09-30T04:56:35Z',type:'status',text:'HadiGODev moved this to Todo in BE-TASK'},
      {datetime:'2026-09-30T04:56:40Z',type:'pull_request',text:'allifgobimbel linked a pull request that will close this issue #2880'}
    ]}
  });
  assert.equal(result.start,'2026-09-30T04:56:35Z');
  assert.equal(result.end,'2026-09-30T04:56:40Z');
  assert.ok(result.hours > 0 && result.hours < 0.01);
  assert.equal(result.needsReview,false);
});

test('In Progress memakai aktivitas kerja terakhir pada hari yang sama sebagai titik akhir', () => {
  const url='https://github.com/GO-Bimbel/go-superapp-api/issues/3807';
  const result=decideTimes({ticketUrl:url,date:'2026-09-08',session:'11:00',status:'in progress'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-09-08T04:21:36Z',type:'status',text:'allifgobimbel moved this to In Progress in BE-TASK'},
      {datetime:'2026-09-08T08:55:03Z',type:'pull_request',text:'allifgobimbel linked a pull request that will close this issue #3812'},
      {datetime:'2026-09-08T08:56:08Z',type:'status',text:'allifgobimbel moved this from In Progress to Ready to Review in BE-TASK'}
    ]}
  });
  assert.equal(result.start,'2026-09-08T04:21:36Z');
  assert.equal(result.end,'2026-09-08T08:56:08Z');
  assert.ok(result.hours > 0);
});

test('In Progress pada DSM 16 berakhir pada jam pulang kerja', () => {
  const url='https://github.com/GO-Bimbel/service/issues/9';
  const result=decideTimes({ticketUrl:url,date:'2026-09-08',session:'16:00',sessions:['16:00'],status:'In Progress'}, {
    [url]:{url,linkedUrls:[],events:[{datetime:'2026-09-08T07:00:00Z',type:'status',text:'moved this to In Progress'}]}
  });
  assert.equal(result.rule,'IN_PROGRESS_UNTIL_WORKDAY_END');
  assert.match(result.end,/2026-09-08T17:00:00\+07:00/);
});

test('lanjutan tiket hari berikutnya dimulai tepat pukul 09.00', () => {
  const url='https://github.com/GO-Bimbel/service/issues/9';
  const result=decideTimes({ticketUrl:url,date:'2026-09-09',session:'16:00',sessions:['16:00'],status:'In Progress',continuedFromPreviousDay:true}, {
    [url]:{url,linkedUrls:[],events:[]}
  });
  assert.match(result.start,/2026-09-09T09:00:00\+07:00/);
  assert.match(result.end,/2026-09-09T17:00:00\+07:00/);
});

test('In Progress pada DSM 16 hari Sabtu berakhir pukul 16.00', () => {
  const url='https://github.com/GO-Bimbel/service/issues/10';
  const result=decideTimes({ticketUrl:url,date:'2026-09-12',session:'16:00',sessions:['16:00'],status:'In Progress'}, {
    [url]: {url,events:[],linkedUrls:[]}
  });
  assert.equal(result.end,'2026-09-12T16:00:00+07:00');
  assert.equal(result.hours,3);
});

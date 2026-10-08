import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTimes, latestGitHubStatus, isNextWorkday } from '../src/lib/activity-matcher.js';

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

test('In Progress linked diabaikan untuk start tetapi PR linked tetap menjadi end', () => {
  const url='https://github.com/GO-Bimbel/service/issues/1';
  const child='https://github.com/GO-Bimbel/service/issues/2';
  const result=decideTimes({ticketUrl:url,date:'2026-09-08',session:'16:00'}, {
    [url]:{url,linkedUrls:[child],events:[]},
    [child]:{url:child,events:[
      {datetime:'2026-09-08T07:00:00Z',type:'status',text:'moved this to In Progress'},
      {datetime:'2026-09-08T08:30:00Z',type:'pull_request',text:'opened pull request for review'}
    ]}
  });
  assert.equal(result.rule,'NEEDS_REVIEW_NO_VALID_START');
  assert.equal(result.start,null);
  assert.equal(result.endSource,child);
  assert.equal(result.startEvidence,'');
});

test('Todo diabaikan dan tidak ada lagi fallback Start dari DSM', () => {
  const url='https://github.com/GO-Bimbel/gotim/issues/877';
  const result=decideTimes({ticketUrl:url,date:'2026-09-02',session:'16:00',status:'ready to review'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-09-02T08:50:56Z',type:'status',text:'moved this to Todo in BE-TASK'},
      {datetime:'2026-09-02T09:42:10Z',type:'status',text:'moved this from Todo to Ready to Review in BE-TASK'}
    ]}
  });
  assert.equal(result.rule,'NEEDS_REVIEW_NO_VALID_START');
  assert.equal(result.start,null);
  assert.equal(result.end,'2026-09-02T09:42:10Z');
  assert.equal(result.hours,0);
  assert.equal(result.startEvidence,'');
});

test('jam efektif memotong istirahat satu jam', () => {
  const url='https://github.com/GO-Bimbel/gotim/issues/877';
  const result=decideTimes({ticketUrl:url,date:'2026-09-03',session:'11:00',status:'staging'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-09-03T02:00:00Z',type:'comment',body:'start',text:'allif commented on issue: start'},
      {datetime:'2026-09-03T09:03:05Z',type:'status',text:'moved this from Ready to Review to Staging in BE-TASK'}
    ]}
  });
  assert.equal(result.start,'2026-09-03T02:00:00Z');
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
      {datetime:'2026-09-01T02:00:00Z',type:'comment',body:'start',text:'allif commented on issue: start'},
      {datetime:'2026-09-01T02:27:04Z',type:'pull_request',text:'allifgobimbel linked a pull request that will close this issue #2801'}
    ]}
  });
  assert.equal(result.start,'2026-09-01T02:00:00Z');
  assert.equal(result.end,'2026-09-01T02:27:04Z');
  assert.equal(result.endSourceKind,'parent');
});

test('comment dan review GraphQL merupakan bukti End Time', () => {
  const url='https://github.com/GO-Bimbel/api/issues/1';
  const pr='https://github.com/GO-Bimbel/api/pull/2';
  const result=decideTimes({ticketUrl:url,date:'2026-09-08',session:'11:00',status:'ready to review'}, {
    [url]:{url,linkedUrls:[pr],events:[{datetime:'2026-09-08T02:00:00Z',type:'status',text:'moved this to In Progress'}]},
    [pr]:{url:pr,events:[
      {datetime:'2026-09-08T05:00:00Z',type:'comment',text:'reviewer commented on pull request'},
      {datetime:'2026-09-08T06:00:00Z',type:'review',text:'reviewer submitted approved review'}
    ]}
  });
  assert.equal(result.end,'2026-09-08T06:00:00Z');
  assert.equal(result.endSource,pr);
});

test('komentar start dan end menjadi fallback waktu saat status history hilang', () => {
  const url='https://github.com/GO-Bimbel/api/issues/99';
  const result=decideTimes({ticketUrl:url,date:'2026-10-08',session:'11:00',status:'Ready to Review'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-10-08T02:15:00Z',type:'comment',body:'START',text:'allif commented on issue: START'},
      {datetime:'2026-10-08T07:45:00Z',type:'comment',body:'end',text:'allif commented on issue: end'}
    ]}
  });
  assert.equal(result.rule,'COMMENT_START_MATCHED_END');
  assert.equal(result.start,'2026-10-08T02:15:00Z');
  assert.equal(result.end,'2026-10-08T07:45:00Z');
  assert.match(result.endEvidence,/end/i);
  assert.equal(result.needsReview,false);
});

test('komentar biasa bukan marker start atau end', () => {
  const url='https://github.com/GO-Bimbel/api/issues/100';
  const result=decideTimes({ticketUrl:url,date:'2026-10-08',session:'11:00',status:'Ready to Review'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-10-08T02:15:00Z',type:'comment',body:'mulai dikerjakan',text:'allif commented on issue: mulai dikerjakan'},
      {datetime:'2026-10-08T07:45:00Z',type:'comment',body:'sudah selesai',text:'allif commented on issue: sudah selesai'}
    ]}
  });
  assert.equal(result.rule,'NEEDS_REVIEW_NO_VALID_END');
  assert.equal(result.start,null);
  assert.equal(result.end,null);
});

test('kata start atau end di dalam kalimat tidak dianggap marker', () => {
  const url='https://github.com/GO-Bimbel/api/issues/101';
  const result=decideTimes({ticketUrl:url,date:'2026-10-08',session:'11:00',status:'Ready to Review'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-10-08T02:15:00Z',type:'comment',body:'hal ini akan di start',text:'allif commented on issue: hal ini akan di start'},
      {datetime:'2026-10-08T07:45:00Z',type:'comment',body:'pekerjaan sudah end',text:'allif commented on issue: pekerjaan sudah end'}
    ]}
  });
  assert.equal(result.start,null);
  assert.equal(result.end,null);
  assert.equal(result.rule,'NEEDS_REVIEW_NO_VALID_END');
});

test('marker menerima perbedaan kapital dan spasi tepi saja', () => {
  const url='https://github.com/GO-Bimbel/api/issues/102';
  const result=decideTimes({ticketUrl:url,date:'2026-10-08',session:'11:00',status:'Ready to Review'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-10-08T02:15:00Z',type:'comment',body:'  START  ',text:'allif commented on issue: START'},
      {datetime:'2026-10-08T07:45:00Z',type:'comment',body:' End ',text:'allif commented on issue: End'}
    ]}
  });
  assert.equal(result.start,'2026-10-08T02:15:00Z');
  assert.equal(result.end,'2026-10-08T07:45:00Z');
});

test('durasi beberapa detik tetap valid dan tidak dipanjangkan', () => {
  const url='https://github.com/GO-Bimbel/db-go/issues/2879';
  const result=decideTimes({ticketUrl:url,date:'2026-09-30',session:'11:00',status:'deployed'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-09-30T04:56:35Z',type:'status',text:'HadiGODev moved this to In Progress in BE-TASK'},
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

test('komentar end mengalahkan jam pulang untuk In Progress DSM 16', () => {
  const url='https://github.com/GO-Bimbel/service/issues/91';
  const result=decideTimes({ticketUrl:url,date:'2026-09-08',session:'16:00',sessions:['16:00'],status:'In Progress'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-09-08T07:00:00Z',type:'comment',body:'start',text:'allif commented on issue: start'},
      {datetime:'2026-09-08T09:15:00Z',type:'comment',body:'end',text:'allif commented on issue: end'}
    ]}
  });
  assert.equal(result.start,'2026-09-08T07:00:00Z');
  assert.equal(result.end,'2026-09-08T09:15:00Z');
  assert.equal(result.rule,'COMMENT_START_MATCHED_END');
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
    [url]: {url,events:[{datetime:'2026-09-12T06:00:00Z',type:'comment',body:'start',text:'allif commented on issue: start'}],linkedUrls:[]}
  });
  assert.equal(result.end,'2026-09-12T16:00:00+07:00');
  assert.equal(result.hours,3);
});

test('rekap unik mengambil status GitHub paling terakhir', () => {
  const url='https://github.com/GO-Bimbel/service/issues/11';
  const status=latestGitHubStatus(url,{
    [url]:{url,events:[
      {datetime:'2026-09-10T03:00:00Z',type:'status',text:'moved this from Todo to In Progress'},
      {datetime:'2026-09-10T08:00:00Z',type:'status',text:'moved this from In Progress to Ready to Review'},
      {datetime:'2026-09-11T04:00:00Z',type:'status',text:'moved this from Ready to Review to Staging'}
    ]}
  });
  assert.equal(status,'staging');
});

test('kelanjutan memakai hari kerja berikutnya termasuk Sabtu ke Senin', () => {
  assert.equal(isNextWorkday('2026-09-11','2026-09-12'),true);
  assert.equal(isNextWorkday('2026-09-12','2026-09-14'),true);
  assert.equal(isNextWorkday('2026-09-12','2026-09-13'),false);
  assert.equal(isNextWorkday('2026-09-11','2026-09-14'),false);
});

test('In Progress diprioritaskan atas Todo sebagai start', () => {
  const url='https://github.com/GO-Bimbel/service/issues/12';
  const result=decideTimes({ticketUrl:url,date:'2026-09-22',session:'16:00',status:'Ready to Review'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-09-22T02:00:00Z',type:'status',text:'moved this to Todo'},
      {datetime:'2026-09-22T03:00:00Z',type:'status',text:'moved this from Todo to In Progress'},
      {datetime:'2026-09-22T08:00:00Z',type:'status',text:'moved this from In Progress to Ready to Review'}
    ]}
  });
  assert.equal(result.start,'2026-09-22T03:00:00Z');
  assert.match(result.startEvidence,/In Progress/i);
});

test('Todo tidak pernah dipakai sebagai start dan tanpa fallback DSM', () => {
  const url='https://github.com/GO-Bimbel/db-sekolah/issues/1272';
  const result=decideTimes({ticketUrl:url,date:'2026-09-22',session:'16:00',sessions:['16:00'],status:'In Progress'}, {
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-09-22T10:04:37Z',type:'status',text:'moved this to Todo'}
    ]}
  });
  assert.equal(result.start,null);
  assert.equal(result.end,'2026-09-22T17:00:00+07:00');
  assert.equal(result.hours,0);
  assert.equal(result.needsReview,true);
});

test('issue #1272 memakai In Progress 23 September, bukan Todo 22 September', () => {
  const url='https://github.com/GO-Bimbel/db-sekolah/issues/1272';
  const scans={
    [url]:{url,linkedUrls:[],events:[
      {datetime:'2026-09-22T10:04:37Z',type:'status',text:'HadiGODev moved this to Todo in BE-TASK'},
      {datetime:'2026-09-23T03:42:49Z',type:'status',text:'dwikyananditya moved this from Todo to In Progress in BE-TASK'},
      {datetime:'2026-09-23T04:32:33Z',type:'status',text:'dwikyananditya moved this from In Progress to Ready to Review in BE-TASK'}
    ]}
  };

  const september22=decideTimes({ticketUrl:url,date:'2026-09-22',session:'16:00',sessions:['16:00'],status:'In Progress'},scans);
  assert.equal(september22.start,null);
  assert.equal(september22.startEvidence,'');

  const september23=decideTimes({ticketUrl:url,date:'2026-09-23',session:'11:00',status:'Ready to Review'},scans);
  assert.equal(september23.start,'2026-09-23T03:42:49Z');
  assert.equal(september23.end,'2026-09-23T04:32:33Z');
  assert.match(september23.startEvidence,/In Progress/i);
});

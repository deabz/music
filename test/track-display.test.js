const {test}=require('node:test');
const assert=require('node:assert/strict');
const {displayTrack}=require('../src/track-display');
test('public metadata uses parsed artists instead of uploader labels and cleans video suffixes',()=>{
 assert.deepEqual(displayTrack({title:'Mira - Afterglow (Official Video) [Official Audio]',artist:'7clouds'}),{title:'Afterglow',artist:'Mira'});
 assert.deepEqual(displayTrack({title:'Mira VEVO - Afterglow - Lyrics',artist:'7clouds'}),{title:'Afterglow',artist:'Mira'});
 assert.deepEqual(displayTrack({title:'Afterglow',artist:'7clouds'}),{title:'Afterglow',artist:''});
 assert.deepEqual(displayTrack({title:'Afterglow [Lyrics]',artist:'Some upload channel',uploader:'Some upload channel'}),{title:'Afterglow',artist:''});
 assert.deepEqual(displayTrack({title:'Afterglow (Official Audio)',artist:'Mira - Topic'}),{title:'Afterglow',artist:'Mira'});
 assert.deepEqual(displayTrack({title:'Afterglow',artist:'MiraVEVO'}),{title:'Afterglow',artist:'Mira'});
 assert.deepEqual(displayTrack({title:'Afterglow',artist:'Mira Official'}),{title:'Afterglow',artist:'Mira'});
 assert.deepEqual(displayTrack({title:'Other - Afterglow',artist:'7clouds',artistName:'Mira'}),{title:'Afterglow',artist:'Mira'});
 assert.deepEqual(displayTrack({title:'Afterglow',artist:'Mira'}),{title:'Afterglow',artist:'Mira'});
});
test('display normalization never mutates a source snapshot or returns private fields',()=>{
 const track=Object.freeze({title:'Mira - Afterglow',artist:'7clouds',server:'private',channel:'private',requestedBy:'private',url:'private'});
 const result=displayTrack(track);
 assert.deepEqual(Object.keys(result),['title','artist']);
 assert.equal(track.title,'Mira - Afterglow');
});

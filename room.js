var redis = require('redis');
var db = redis.createClient();
var pub = redis.createClient();
var resultMsg = {};	// avoid duplicate rooms
var errMsg = [];
var timeoutsearch = [];
var setRoomOps = [];
var totalOps = 0;
var SEARCH_TIMEOUT = 5000;

function beginOp () {
	++totalOps;
}

function endOp () {
	--totalOps;
	if (totalOps == 0) {
		doPublish();
	} else if (totalOps < 0) {
		throw new Error('wrong op');
	}
}

function RecruitInfo (datastr) {
	var data = datastr.split(',');
	this.roomid = data[0];
	this.lvmin = data[1];
	this.lvmax = data[2];
	this.mapid = data[3];
	this.uids = [];
}

RecruitInfo.prototype.welcomeSearch = function (search) {
	return this.mapid == search.mapid 
		&& this.lvmin <= search.lv 
		&& this.lvmax >= search.lv
		&& this.len < 4
		&& this.uids.indexOf(search.uid)==-1;
}

RecruitInfo.prototype.has = function (search) {
	return this.uids.indexOf(search.uid) != -1;
}

RecruitInfo.prototype.accept = function (search) {
	this.uids.push(search.uid);
	this.len = this.uids.length;

	//console.log('begin accept');
	beginOp();
	// db ops
	// add uid to room:<roomid>
	var roomid = this.roomid;
	resultMsg[roomid] = true;
	setRoomOps.push('roomid:'+search.uid, roomid);

	db.rpush('room:'+roomid, search.uid, function(){
		endOp();
		//console.log('end accept', resultMsg, setRoomOps);
	});
}

RecruitInfo.prototype.welcomeJoin = function (join) {
	return this.roomid == join.roomid
		&& this.mapid == join.mapid
		&& this.len < 4
		&& this.uids.indexOf(join.uid)==-1;
}

function JoinInfo (datastr) {
	var data = datastr.split(',');
	this.uid = data[0];
	this.roomid = data[1];
	this.mapid = data[2];
}

function SearchInfo (datastr) {
	var data = datastr.split(',');
	this.uid = data[0];
	this.lv = data[1];
	this.mapid = data[2];
	this.time = data[3];
}

// set all roomid:uid to <roomid>
function doPublish () {
	var rooms = [];
	for (var roomid in resultMsg) {
		rooms.push(roomid);
	}
	if (rooms.length > 0) {
		//console.log('pub',rooms);
		pub.publish('recruit.rooms', rooms, function(err,data){
			//console.log(err,data);
		});
	}
	if (errMsg.length > 0) {
		pub.publish('recruit.err', errMsg);
	}
	if (timeoutsearch.length > 0) {
		pub.publish('recruit.timeout', timeoutsearch);
	}
}

function recruit () {
	if (totalOps > 0) {
		//console.log(totalOps, 'unfinished ops');
		return;
	}

//	console.log('---------');
	resultMsg = {};
	errMsg = [];
	setRoomOps = [];
	timeoutsearch = [];

	beginOp();

	// swap read & write queue
	db.llen('recruit_write', function(err,recruit_len){
		db.llen('search_write', function(err,search_len){
			db.llen('join_write',function(err,join_len){
				var only_recruit = recruit_len>0 && search_len==0 && join_len==0;
//				var only_search = recruit_len==0 && search_len>0 && join_len==0;
				var nothing = recruit_len==0 && search_len==0 && join_len==0;
				if (nothing || only_recruit) {
//					console.log('early out');

					// search timeout
/*					if (only_search) {
						db.lrange('search_write', function(err,searchlist){
							for (var i=0; i<searchlist.length; i++) {
								var search = new SearchInfo(searchlist[i]);
								if (Date.now() - search.time > SEARCH_TIMEOUT) {
								}
							}
						});
					} else {
					*/
						endOp();
					//}
					return;
				}

				var multi = db.multi();
				if (recruit_len>0) {
					multi.rename('recruit_write', 'recruit_read');
				} else {
					multi.del('recruit_read');
				}
				if (search_len>0) {
					multi.rename('search_write', 'search_read');
				} else {
					multi.del('search_read');
				}
				if (join_len>0) {
					multi.rename('join_write', 'join_read');
				} else {
					multi.del('join_read');
				}
				multi.exec(doRecruit);
			});
		});
	});
	function doRecruit(err,data){
		db.lrange('search_read', 0, -1, function(err, searchlist){	// get search list
			db.lrange('join_read', 0, -1, function(err, joinlist){	// get join list
				db.lrange('recruit_read', 0, -1, function(err, recruitlist){	// get recruit list
					var recruitinfo_forjoin = {};	// roomid -> {lvmin, lvmax, mapid, len}
					var recruitinfo = [];
					var validrecruit = [];
					var joininfo = [];
					var searchinfo = [];
					var joinanony = [];
					var anonycnt = {};
					var roomuids= {};	// {<roomid>:[<uid>,<uid>,...]}
					var joinroom = {};
					var recruitlist_write = [];
					var searched = {};

					// process recruit info
					for (var i=0; i<recruitlist.length; i++) {
						// [roomid, lvmin, lvmax, mapid]
						var rec = new RecruitInfo(recruitlist[i]);
						rec.data = recruitlist[i];
						if (!roomuids.hasOwnProperty(rec.roomid)) {	// skip identical recruits
							roomuids[rec.roomid] = recruitinfo.length;
							recruitinfo.push(rec);
						} else {	// replace old recruit for this roomid
							recruitinfo[roomuids[rec.roomid]] = rec;
						}
					}

					for (var i=0; i<joinlist.length; i++) {
						var join = new JoinInfo(joinlist[i]);
						roomuids[join.roomid] = 0;
						joinroom[join.roomid] = 1;
						joininfo.push(join);
					}

					if (recruitinfo.length==0 && joininfo.length==0) {
						//console.log('early out 2: no recruit or join');

						// all search failed
						if (searchlist.length > 0) {

							// search timeout
							var validsearch = [];
							var now = Date.now();
							for (var i=0; i<searchlist.length; i++) {
								var search = new SearchInfo(searchlist[i]);
								if (now - search.time < SEARCH_TIMEOUT) {
									validsearch.push(searchlist[i]);
								} else {
									timeoutsearch.push(search.uid);
								}
							}
							if (validsearch.length > 0) {
								db.rpush.apply(db, [].concat('search_write', searchlist, function(){
									endOp();
								}));
							} else {
								endOp();
							}
						}
						return;
					}

					// get room sizes
					var roomcnt = 0;
					var qrycnt = 0;
					for (var roomid in roomuids) {
						++roomcnt;
						db.lrange('room:'+roomid, 0, -1, (function(roomid){
							return function(err,roomdata){
								++qrycnt;
								roomuids[roomid] = roomdata;
								if (qrycnt != roomcnt) {	
									return;
								}

								// qrycnt == roomcnt, we have all lengths, yay!

								// update length info
								for (var i=0; i<recruitinfo.length; i++) {
									var rec = recruitinfo[i];
									rec.uids = roomuids[rec.roomid];
									rec.len = rec.uids ? rec.uids.length : 0;
									var valid = true;
									if (rec.len < 4) {
										// invalid recruit: empty room & nobody wants to join
										if (rec.len == 0 && !joinroom[rec.roomid]) {
											valid = false;
										} else {
											validrecruit.push(rec);
											recruitinfo_forjoin[rec.roomid] = rec;
										}
									}

									if (valid) {
										recruitlist_write.push(rec.data);
									}
								}

								for (var i=0; i<joininfo.length; i++) {
									// [uid, roomid, mapid]
									var join = joininfo[i];
									var rec = recruitinfo_forjoin[join.roomid];
									var err = true;
									if (rec) {
										if (rec.welcomeJoin(join)) {
											rec.accept(join);
											if (rec.len >= 4) {	// full
												delete recruitinfo_forjoin[join.roomid];
												delete validrecruit[validrecruit.indexOf(rec)];
											}
											err = false;
										}
									} else {
										// join an anonymous room (not in the recruit list)
										joinanony.push(join);
										err = false;
									}

									// something wrong
									// publish err
									if (err) {
										errMsg.push(join.uid);
									}
								}

								var failedsearch = [];
								for (var i=0; i<searchlist.length; i++) {
									// [uid, lv, mapid, unixtime]
									var search = new SearchInfo(searchlist[i]);

									// search timeout
									if (Date.now() - search.time > SEARCH_TIMEOUT) {
										timeoutsearch.push(search.uid);
										continue;
									}

									// skip duplicated searches
									if (searched[search.uid]) {
										continue;
									}
									searched[search.uid] = true;

									// brute force search
									var failed = true;
									for (var j=0; j<validrecruit.length; j++) {
										var rec = validrecruit[j];
										if (rec.welcomeSearch(search)) {
											rec.accept(search);
											failed = false;
											if (rec.len >= 4) {
												delete validrecruit[validrecruit.indexOf(rec)];
												break;
											}
										} else if (rec.has(search)){	// already recruited
											failed = false;
											break;
										}
									}

									if (failed) {
										failedsearch.push(searchlist[i]);
									}
								}

								// anonymous joins
								joinanony.forEach(function(join, i){
									var uids = roomuids[join.roomid];
									var cnt = uids ? uids.length : 0;
									if (cnt && (uids.indexOf(join.uid) != -1 || cnt >= 4)) {	// room full
										errMsg.push(join.uid);
									} else {
										beginOp();
										uids.push(join.uid);
										resultMsg[join.roomid] = true;
										setRoomOps.push('roomid:'+join.uid, join.roomid);
										db.rpush('room:'+roomid, join.uid, function(){
											endOp();
										});
									}
								});

								// write back failed items

								// failed recruit
								//console.log('recruitlist',recruitlist_write);
								if (recruitlist_write.length > 0) {
									beginOp();
									db.rpush.apply(db, ['recruit_write'].concat(recruitlist_write).concat([function(){
										endOp();
									}]));
								}

								// failed search
								//console.log('failedsearch',failedsearch);
								if (failedsearch.length > 0) {
									beginOp();
									db.rpush.apply(db, ['search_write'].concat(failedsearch).concat([function(){
										endOp();
									}]));
								}

								//console.log('setroomops',setRoomOps);
								if (setRoomOps.length > 0) {
									beginOp();
									db.mset(setRoomOps, function(err){
										endOp();
									});
								}

								endOp();
							}
						})(roomid));
					}
				});
			});
		});
	}
}

setInterval(recruit, 1000);


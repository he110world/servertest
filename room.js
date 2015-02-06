var redis = require('redis');
var db = redis.createClient();
var recruitpub = redis.createClient();
var recruitsub = redis.createClient();
var resultMsg = [];
var errMsg = [];
var setRoomOps = [];
var totalOps = 0;

recruitsub.subscribe('recruit');
recruitsub.on('message', function(channel, message){
	try {
		var msg = JSON.parse(message);
	} catch(e) {
		msg = {};
	}

	switch (msg.cmd) {
		case 'recruit':	// room wants to recruit
			// add/change recruit info
			// [roomid, lvmin, lvmax, mapid]

			// get num of seats available
			try {
				var roomid = msg.data.split(',')[0];
			} catch(e) {
				return;
			}
			db.rpush('recruit_write', msg.data);	
			break;
		case 'search':	// player wants to search
			// add/change search info
			// uid lv mapid
			db.rpush('search_write', msg.data);
			break;
		case 'join':	// player wants to join a room
			// add/change join info
			// uid roomid mapid
			// possible err: wrong mapid
			db.rpush('join_write', msg.data);
			break;
	}
});

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
}

RecruitInfo.prototype.welcomeSearch = function (search) {
	return this.mapid == search.mapid 
		&& this.lvmin <= search.lv 
		&& this.lvmax >= search.lv
		&& this.len < 4;
}

RecruitInfo.prototype.accept = function (search) {
	++this.len;
	beginOp();
	// db ops
	// add uid to room:<roomid>
	db.rpush('room:'+this.roomid, search.uid, function(){
		resultMsg.push(search.uid);
		setRoomOps.push('roomid:'+search.uid, this.roomid);
		endOp();
	});
}

RecruitInfo.prototype.welcomeJoin = function (join) {
	return this.roomid == join.roomid
		&& this.mapid == join.mapid
		&& this.len < 4;
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
}

// set all roomid:uid to <roomid>
function doPublish () {
	if (resultMsg.length > 0) {
		recruitpub.publish('recruit', resultMsg);
	}
	if (errMsg.length > 0) {
		recruitpub.publish('err', errMsg);
	}
}

function recruit () {
	if (totalOps > 0) {
		console.log(totalOps);
		return;
	}

	resultMsg = [];
	errMsg = [];
	setRoomOps = [];

	console.log('update');

	beginOp();

	// swap read & write queue
	db.multi()
	.rename('recruit_write', 'recruit_read')
	.rename('search_write', 'search_read')
	.rename('join_write', 'join_read')
	.exec(function(err,data){
		db.lrange('search_read', 0, -1, function(err, searchlist){	// get search list
			db.lrange('join_read', 0, -1, function(err, joinlist){	// get join list
				if (searchlist.length == 0 && joinlist.length == 0) {	// nobody will enter any room
					endOp();
					return;
				}
				db.lrange('recruit_read', 0, -1, function(err, recruitlist){	// get recruit list
					var recruitinfo_forjoin = {};	// roomid -> {lvmin, lvmax, mapid, len}
					var recruitinfo = [];
					var validrecruit = [];
					var joininfo = [];
					var searchinfo = [];
					var joinanony = [];
					var anonycnt = {};
					var roomlen = {};
					var joinroom = {};
					var recruitlist_write = [];

					// process recruit info
					for (var i=0; i<recruitlist.length; i++) {
						// [roomid, lvmin, lvmax, mapid]
						var rec = new RecruitInfo(recruitlist[i]);
						if (!roomlen.hasOwnProperty(rec.roomid)) {	// skip identical recruits
							roomlen[rec.roomid] = 0;
							recruitinfo.push(rec);
							rec.data = recruitlist[i];
						}
					}

					for (var i=0; i<joinlist.length; i++) {
						var join = new JoinInfo(joinlist[i]);
						roomlen[join.roomid] = 0;
						joinroom[join.roomid] = 1;
						joininfo.push(join);
					}

					// get room sizes
					var roomcnt = 0;
					var qrycnt = 0;
					for (var roomid in roomlen) {
						++roomcnt;
						db.llen('room:'+roomid, (function(roomid){
							return function(err,len){
								++qrycnt;
								roomlen[roomid] = len;
								if (qrycnt != roomcnt) {	
									return;
								}
								// qrycnt == roomcnt, we have all lengths, yay!

								// update length info
								for (var i=0; i<recruitinfo.length; i++) {
									var rec = recruitinfo[i];
									rec.len = roomlen[rec.roomid];
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
									// [uid, lv, mapid]
									var search = new SearchInfo(searchlist[i]);

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
										}
									}

									if (failed) {
										failedsearch.push(searchlist[i]);
									}
								}

								// anonymous joins
								joinanony.forEach(function(join, i){
									var cnt = roomlen[join.roomid];
									if (cnt && cnt >= 4) {	// room full
										errMsg.push(join.uid);
									} else {
										++roomlen[join.roomid];
										beginOp();
										db.set('roomid:'+join.uid, join.roomid, function(){
											resultMsg.push(join.uid);
											setRoomOps.push('roomid:'+join.uid, join.roomid);
											endOp();
										});
									}
								});

								// write back failed items

								// failed recruit
								if (recruitlist_write.length > 0) {
									beginOp();
									db.rpush.apply(db, ['recruit_write'].concat(recruitlist_write).concat[function(){
										endOp();
									}]);
								}

								// failed search
								if (failedsearch.length > 0) {
									beginOp();
									db.rpush.apply(db, ['search_write'].concat(failedsearch).concat[function(){
										endOp();
									}]);
								}

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
	});
}

setInterval(recruit, 1000);


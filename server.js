/*
var cluster = require('cluster');
var numCPUs = require('os').cpus().length;

if (cluster.isMaster) {
	// fork workers
	for (var i=0; i<numCPUs; i++) {
		cluster.fork();
	}

	cluster.on('exit', function(worker, code, signal) {
		console.log('worker ' + worker.process.pid + 'exit');
	});
} else {
*/
var redis = require('redis');
var db = redis.createClient();
var pub = redis.createClient();
var sub = redis.createClient();
var table = require('./table.json');
var Transaction = require('./transaction');
var Role = require('./role');
var Girl = require('./girl');
var Equip = require('./equip');
var Gift = require('./gift');
var GIRL_PRICE = 100;

console.log("Server started");
var port = parseInt(process.argv[2]);
var WebSocketServer = require('ws').Server;
var wss = new WebSocketServer({port: port});
var uid2ws = {};	// uid->ws
var ws2uid = {};
var appid = randomString(32);

function response (ws, cmd, data, id) {
	if (ws.readyState != ws.OPEN) {
		return;
	}
	var resp = {};
	resp.cmd = cmd;
	resp.data = data;
	if (id) {
		resp.id = id;
	}
	ws.send(JSON.stringify(resp));
}

function responseErr (ws, cmd, err, id) {
	if (ws.readyState != ws.OPEN) {
		return;
	}
	var resp = {};
	resp.cmd = cmd;
	resp.err = err;
	if (id) {
		resp.id = id;
	}
	ws.send(JSON.stringify(resp));
}

function publishData (pub, channel, data) {
	pub.publish(channel, JSON.stringify(data));
}

function randomString(bits){
	var chars,rand,i,ret;
	chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	ret='';
	// in v8, Math.random() yields 32 pseudo-random bits (in spidermonkey it gives 53)
	while(bits > 0){
		rand=Math.floor(Math.random()*0x100000000); // 32-bit integer
		// base 64 means 6 bits per character, so we use the top 30 bits from rand to give 30/6=5 characters.
		for(i=26; i>0 && bits>0; i-=6, bits-=6) {
			ret+=chars[0x3F & rand >>> i];
		}
	}
	return ret;
}

function generateSession (cb) {
	var session = randomString(32);
	cb(session);
}

function Teammate (uid) {
	this.role = {ID:uid};
	this.team = [];
	this.girl = {};
}

Teammate.prototype.initRole = function (roleData) {
	this.role.RoomTeam = roleData[0];
	this.role.Lv = roleData[1];
	this.role.Nick = roleData[2];
}

Teammate.prototype.initTeam = function (teamData) {
	this.team = teamData;
}

Teammate.prototype.addGirl = function (girlData) {
	this.girl[girlData.ID] = girlData;
}


sub.psubscribe('recruit.*');
sub.on('pmessage', function(pattern, channel, message){
	console.log(pattern,channel,message);
	if (pattern == 'recruit.*') {
		var cmd = channel.split('.')[1];
		switch (cmd) {
			case 'rooms':
				//[roomid,roomid,...]
				console.log(message);
				if (message.length > 0) {
					var roomids = message.split(',');

					// find room members on this server
					roomids.forEach(function(roomid, i){
						db.lrange('room:'+roomid, 0, -1, function(err, uids){
							console.log(uids);
							for (var j=0; j<uids.length; j++) {
								wss.sendcmd(uids[j], 'roomdirty');
							}
						});
					});
				}
				break;
			case 'err':
				//[uid,uid,...]
				if (message.length > 0) {
					var uids = message.split(',');
					for (var i=0; i<uids.length; i++) {
						wss.sendcmd(uids[i], 'joinfail');
					}
				}
				break;
			case 'timeout':
				//[uid,uid,...]
				if (message.length > 0) {
					var uids = message.split(',');
					for (var i=0; i<uids.length; i++) {
						wss.sendcmd(uids[i], 'searchfail');
					}
				}
				break;
		}
	}
});

sub.subscribe('admin');
sub.subscribe('user');
sub.subscribe('room');
sub.on('message', function(channel, message){
	try {
		var msg = JSON.parse(message);
	} catch(e) {
		msg = {};
		console.log(e);
	}

	if (channel == 'room') {
		var roomid = msg.id;
		
		// find users in the room
		db.lrange('room:'+roomid, 0, -1, function(err, uids){
			if (msg.op == 'chat') {
				for (var i=0; i<uids.length; i++) {
					wss.sendobj(uids[i], 'chat', {msg:msg.data});
				}
			} else if (msg.op == 'quit') {
				console.log('send quit',uids);
				for (var i=0; i<uids.length; i++) {
					wss.sendcmd(uids[i], 'roomdirty');
				}
			}
		});
	} else if (channel == 'user') {
		switch (msg.cmd) {
			case 'kick':
				if (appid != msg.appid) {	// don't kick yourself!
					wss.kick(msg.uid);
				}
				break;
			case 'notify':
				wss.notify(msg.uid, msg.msgstr);
				break;
		}
	} else if (channel == 'admin') {
		switch (msg.cmd) {
			case 'reloadtable':
				try {
					var fs = require("fs");
					table = JSON.parse(fs.readFileSync("./table.json", "utf8"));
				} catch (e) {
					console.log(e);
				}
				break;
			case 'broadcast':
				if (msg.p1) {
					wss.broadcast(msg.p1);
				}
				break;
			case 'kick':
				if (msg.p1) {
					wss.kick(msg.p1);
				}
				break;
		}
	} 
});

function removeWs (ws) {
	var uid = ws2uid[ws];
	if (uid) {
		delete ws2uid[ws];
		delete uid2ws[uid];
	}
}

function roommsg (roomid, cmd, data) {
	publishData(pub, 'room', {id:roomid, op:cmd, data:data});
}

function notifymsg (uid, msg) {
	var ws = uid2ws[uid];
	try {
		var msgstr = JSON.stringify(msg);
		if (ws) {	// same server : don't bother to PUB
			ws.send(msgstr);
		} else {	// different server : simply PUB
			publishData(pub, 'user', {cmd:'notify', uid:uid, msgstr:msgstr});
		}
	} catch (e) {
		console.log(e);
	}
}

function kickmsg (uid) {
	publishData(pub, 'user', {cmd:'kick', uid:uid, appid:appid});
}

var MAX_ROOM_SIZE = 4;

wss.on('connection', function(ws) {
	ws.on('open', function() {
		
	});

	ws.on('close', function(code, message) {
		var uid = ws2uid[ws];
		if (uid) {
			if (code == 4001) {	// kick. code 4000-4999 can be used by application.
				console.log('kick ' + uid);
			} else {
				db.get('session:'+uid, function(err,sess) {
					console.log('close');
					delete uid2ws[uid];
					db.del('session:'+uid, 'sessionuser:'+sess);
				});
			}
			delete ws2uid[ws];
		}
	});

	ws.on('message', function(message) {
		if (message == 'ping') {
			ws.send('pong');
			return;
		}
		try {
			var msg = JSON.parse(message);
		} catch (e) {
			msg = {};
		}

		function getuser (cb) {
			if (typeof cb != 'function') {
				return;
			}
			var session = msg.session;
			if (session) {
				db.get('sessionuser:'+session, function(err, user) {
					if (err || !user) {
						responseErr(ws, msg.cmd, 'session_err', msg.id);
					} else {
						db.get('account:'+user+':id', function(err, uid){
							if (err || !uid) {
								responseErr(ws, msg.cmd, 'account_err', msg.id);
							} else {
								cb(user, uid);
							}
						});
					}
				});
			} else {
				responseErr(ws, msg.cmd, 'session_err', msg.id);
			}
		}

		function check (cb) {
			return function (err, data) {
				if (err) {
					console.log(1,err);
					responseErr(ws, msg.cmd, 'db_err', msg.id);
				} else {
					if (typeof cb == 'function') {
						cb(data);
					}
				}
			}
		}

		function check2 (cb) {
			return function (err, data) {
				if (err || !data) {
					console.log(2,err);
					responseErr(ws, msg.cmd, 'db_err', msg.id);
				} else {
					if (typeof cb == 'function') {
						cb(data);
					}
				}
			}
		}

		function checklist (len, cb) {
			return function (err, data) {
				if (err || !data || data.length!=len) {
					console.log('list',err);
					responseErr(ws, msg.cmd, 'db_err', msg.id);
				} else {
					if (typeof cb == 'function') {
						cb(data);
					}
				}
			}
		}

		function check2err (errmsg, cb) {
			return function (err, data) {
				if (err) {
					console.log('2err',err);
					responseErr(ws, msg.cmd, 'db_err', msg.id);
				} else if (!data) {
					responseErr(ws, msg.cmd, errmsg, msg.id);
				} else {
					if (typeof cb == 'function') {
						cb(data);
					}
				}
			}
		}

		function senderr (errmsg) {
			responseErr(ws, msg.cmd, errmsg, msg.id);
		}

		function sendstr (text) {
			response(ws, msg.cmd, text, msg.id);
		}

		function sendobj (data) {
			response(ws, msg.cmd, data, msg.id);
		}

		function sendnil () {
			response(ws, msg.cmd, '', msg.id);
		}

		function empty(obj) {
			return Object.keys(obj).length === 0;
		}

		var GIRL_GIFT = 14017;
		var SAME_GIRL_GIFT = 14018;
		function addgirl(trans, uid, girlid, price) {
			// already exist?
			db.sismember('girls:'+uid, girlid, check(function(exist){
				var ODD_COIN = 1000;
				if (exist) {
					db.incrby('next_gift_id:'+uid, 2, check2(function(index){	// two gifts for existing girl
						var rare = Math.floor(table.girl[girlid].Rare);
						var multi = trans.multi();
						if (price > 0) {	// buy
							multi
							.hincrby('item', 12001, -price)
							.hsetjson('gift', index-1, new Gift(GIRL_GIFT))	//TODO: real gift
						}
						multi.hsetjson('gift', index, new Gift(SAME_GIRL_GIFT))	// already own this girl
						.exec(check(function(res){	// add medal
							trans.client().set('buygirl', [girlid]);
							sendobj(trans.obj);
						}));
					}));
				} else {
					db.incr('next_gift_id:'+uid, check2(function(index){
						var girl = new Girl;
						girl.newGirl(table, girlid);
						var multi = trans.multi()
						if (price > 0) {	// buy
							multi
							.hincrby('item', 12001, -price)
							.hsetjson('gift', index, new Gift(GIRL_GIFT))	//TODO: real gift
						}
						multi
						.sadd('girls', girlid)
						.hmset('girl.'+girlid, girl)
						.smembers('girls')
						.exec(check(function(res){
							sendobj(trans.obj);
						}));
					}));
				}
			}));
		}

		function resetboard (board) {
			db.exists(board, check(function(exist){
				if (exist) {
					db.multi()
					.del(board+'_gift')				// remove gift info
					.rename(board, board+'_last')	// move to last week
					.exec(check(function(){
						console.log('reset');
						sendnil();
					}));
				} else {
					sendnil();
				}
			}));
		}

		function finishgetboard (board, ranges) {
			var cnt = 0;
			var finallist = [];
			var datalist = [];
			var obj = {};
			obj[board] = finallist;
			if (ranges.length == 0) {
				sendobj(obj);
				return;
			}

			for (var i=0; i<ranges.length; i+=2) {
				db.zrevrange(board, ranges[i], ranges[i+1], 'withscores', check(function(uid_scores){
					cnt += 2;
					datalist.push(uid_scores);
					if (cnt == ranges.length) {	// done!
						for (var j=0; j<datalist.length; j++) {
							var sublist = datalist[j];
							var rankmin = ranges[j*2];
							for (var k=0; k<sublist.length; k+=2) {	// [uid, score, uid, score ...]
								var player =  {ID: sublist[k], Score: sublist[k+1], Rank: rankmin++};
								finallist.push(player);
							}
						}

						// role:<uid>.nickname, team.1:uid
						cnt = 0;
						finallist.forEach(function(player, j){
							db.hget('role:'+finallist[j].ID, 'nickname', check(function(nick){
								db.lindex('team.1:'+finallist[j].ID, 0, check(function(girlid){
									++cnt;
									finallist[j].Nick = nick;
									finallist[j].Girl = girlid;

									if (cnt ==finallist.length) {
										sendobj(obj);
									}
								}));
							}));
						});
					}
				}));
			}
		}

		// board player info: {ID:<uid>, Nick:<nickname>, Rank:<rank>, Girl:<girl>, Score:<score>}
		// return [board_player_info]
		// temp struct: {<uid>:board_player_info}
		function getboard (board, cap) {
			getuser(function(user,uid){
				db.zcard(board, check(function(count){	// board size
					if (!count) {	// empty board
						finishgetboard(board, []);
						return;
					}

					db.zrevrank(board, uid, check(function(myrank){
						// get query list
						var ranges = [];
						var boardmax = Math.min(cap, count)-1;
						if (myrank === null) {
							myrank = boardmax + 1;
						}

						// self
						if (myrank <= boardmax) {	// have rank

							// max(0, myrank-9) -> myrank
							ranges.push([Math.max(0, myrank-9),1], [myrank,-1]);
						}

						// others
		//				if (myrank > 9) {	// not in top10
							// top
							// 0 -> min(9, boardmax)
							ranges.push([0,1], [Math.min(9,boardmax),-1]);


							// bottom
							// max(0, boardmax-9) -> boardmax
							ranges.push([Math.max(0, boardmax-9),1], [boardmax,-1]);
		//				}

						ranges.sort(function(a,b){
							return a[0]-b[0];
						});

						var open = 0;
						var merged = [];
						for (var i=0; i<ranges.length; i++) {
							var r = ranges[i];
							if (r[1] > 0) {
								if (open == 0) {
									if (i > 0 && merged[merged.length-1] == r[0]) {	// e.g. [1,2,2,3] => [1,3]
										merged.pop();
									} else {
										merged.push(r[0]);
									}
								}
								++open;
							} else {
								--open;
								if (open == 0) {
									merged.push(r[0]);
								}
							}
						}
						finishgetboard(board, merged);
					}));
				}));
			});
		}

		function getboardgift (board, max) {
			getuser(function(user,uid){
				// already get the gift?
				db.getbit(board+'_gift', uid, check(function(got){
					if (got) {
						sendnil();
					} else {
						// on last leaderboard?
						db.zrevrank(board+'_last', uid, check(function(rank){
							var oldrank = rank;
							if (rank===null || rank>max) {
								rank = max+1;
							}

							db.setbit(board+'_gift', uid, 1, check(function(){
								if (rank > max) {
									sendnil();
									return;
								}

								var giftid = 14001;	//TODO: real gift

								db.incr('next_gift_id:'+uid, check2(function(index){	// two gifts for existing girl
									var trans = new Transaction(db, uid);
									trans.multi()
									.hset('role', 'OldRank', oldrank)
									.hsetjson('gift', index, new Gift(giftid))
									.exec(check(function(){
										sendobj(trans.obj);
									}));
								}));
							}));
						}));
					}
				}));
			});
		}

		function getlvrange (lv) {
			var lvmin = 1;
			var lvmax = 999;
			if (lv >= 100) {
				lvmin = Math.floor(lv / 100) * 100;
				lvmax = lvmin + 1000;
			} else if (lv >= 50) {
				lvmin = 50;
				lvmax = 100;
			} else {
				lvmin = 1;
				lvmax = 50;
			}
			return {lvmin:lvmin, lvmax:lvmax};
		}

		function makeroom (uid) {
			db.incr('next_room_id', check2(function(newid){
				db.multi()
				.set('roomid:'+uid, newid)
				.lpush('room:'+newid, uid)
//				.expire('roomid:'+uid, 1800)	//TODO: real expire time
//				.expire('room:'+newid, 1800)
				.exec(checklist(2,function(data){
					sendobj({room:{roomid:newid, userid:[uid]}});
				}));
			}));
		}

		function quitroom (uid, cb) {
			db.get('roomid:'+uid, check(function(roomid){
				console.log('quitroom',uid,roomid);
				db.lrange('room:'+roomid, 0, -1, check(function(room){
					// not in this room
					if (room.indexOf(uid) == -1) {
						db.del('roomid:'+uid, check(function(){
							cb(uid,roomid);
						}));
						return;
					}

					if (room.length<=1) { // destroy the room if it's empty
						db.multi()
						.del('room:'+roomid)
						.del('roomid:'+uid)
						.exec(checklist(2,function(){
							cb(uid,roomid);
						}));
					} else { // tell others that I left the room
						db.multi()
						.del('roomid:'+uid)
						.lrem('room:'+roomid, 1, uid)
						.exec(checklist(2,function(){
							cb(uid,roomid);
						}));
					}
				}));
			}));
		}

		switch(msg.cmd) {
		case 'echo': 
			//@cmd echo
			//@nosession
			//@desc 返回客户端发送的数据
			sendobj(msg.data);
			break;

		// leaderboards
		// board gift info stored in bitfield
		case 'SET_Score':
			//@cmd SET_Score
			//@data score
			//@desc 设置得分（如果得分比当前分数低则忽略）
			getuser(function(user,uid){
				try {
					var newscore = Math.floor(msg.data.score);
				} catch (e) {
					senderr('data_err');
					return;
				}

				db.zscore('score', uid, check(function(score){
					if (newscore > score) {
						db.zadd('score', newscore, uid, check(function(){
							sendnil();
						}));
					} else {
						sendnil();
					}
				}));
			});
			break;
		case 'ADD_Contrib':
			//@cmd ADD_Contrib
			//@data contrib
			//@desc 增加贡献值
			getuser(function(user,uid){
				try {
					var addcontrib = Math.floor(msg.data.contrib);
				} catch (e) {
					senderr('data_err');
					return;
				}

				db.zincrby('contrib', addcontrib, uid, check(function(contrib){
					sendobj({contrib:contrib});
				}));
			});
			break;
		case 'RESET_ScoreBoard':
			//@cmd RESET_ScoreBoard
			//@nosession
			//@desc 重置得分排行榜
			resetboard('score');
			break;
		case 'RESET_ContribBoard':
			//@cmd RESET_ContribBoard
			//@nosession
			//@desc 重置贡献值排行榜
			resetboard('contrib');
			break;
		case 'get_scoreboard':
			//@cmd get_scoreboard
			//@desc 获取得分排行榜
			getboard('score', 5000);
			break;
		case 'get_contribboard':
			//@cmd get_contribboard
			//@desc 获取贡献度排行榜
			getboard('contrib', 30000);
			break;
		case 'get_score_gift':
			//@cmd get_score_gift
			//@desc 获取积分奖励
			getboardgift('score', 5000);
			break;
		case 'get_contrib_gift':
			//@cmd get_contrib_gift
			//@desc 获取贡献值奖励
			getboardgift('contrib', 30000);
			break;
		case 'setroomteam':
			//@cmd setroomteam
			//@data teamid
			//@desc 选择多人模式出击战姬
			try {
				var teamid = Math.floor(msg.data.teamid);
				if (!(teamid>=0 && teamid<4)) {
					throw new Error();
				}
			} catch (e) {
				senderr('data_err');
				return;
			}

			getuser(function(user,uid){
				var trans = new Transaction(db, uid);
				trans.hset('role', 'RoomTeam', teamid, check(function(){
					sendobj(trans.obj);
				}));
			});
			break;
		case 'webrecruit':
			//@cmd webrecruit
			//@data roomid
			//@data lvmin
			//@data lvmax
			//@data mapid
			//@desc 组队募集
			try {
				var roomid = msg.data.roomid;
				var lvmin = msg.data.lvmin;
				var lvmax = msg.data.lvmax;
				var mapid = msg.data.mapid;
				if (!roomid || !lvmin || !lvmax || !mapid) {
					throw new Error();
				}
			} catch (e) {
				senderr('data_err');
				return;
			}

			getuser(function(user,uid){
				var recruitstr = [roomid, lvmin, lvmax, mapid].toString();
				db.rpush('recruit_write', recruitstr);
				db.set('recruitinfo:'+roomid, recruitstr, check(function(){
					sendobj({role:{Recruit:recruitstr}});
				}));
			});
			break;
		case 'makeroom':
			//@cmd makeroom
			//@data mapid
			//@desc 开房间
			try {
				var mapid = msg.data.mapid;
			} catch (e) {
				senderr('data_err');
				return;
			}

			getuser(function(user,uid){
				db.exists('roomid:'+uid, check(function(exist){
					if (exist) {
						quitroom(uid, makeroom);
					} else {
						makeroom(uid);
					}	
				}));
			});
			break;
		case 'joinroom':
			//@cmd joinroom
			//@data roomid
			//@data mapid
			//@desc 加入现有房间
			try {
				var roomid = msg.data.roomid;
				var mapid = msg.data.mapid;
				if (!roomid || !mapid) {
					throw new Error();
				}
			} catch(e) {
				senderr('data_err');
				return;
			}

			getuser(function(user,uid){
				var pubstr = [uid,roomid,mapid].toString();

				function doJoin () {
					db.llen('room:'+roomid, check(function(len){
						if (len > 0) {	
							db.rpush('join_write', pubstr);
						} else {	// join a nonexist room
							wss.sendcmd(uid, 'joinfail');
						}
					}));
				}

				db.exists('roomid:'+uid, check(function(exist){
					if (exist) {
						quitroom(uid, function(){
							doJoin();
						});
					} else {
						doJoin();
					}	
				}));

				sendnil();

			/*
				db.exists('roomid:'+uid, check(function(exist){
					if (exist) {
						senderr('already_in_room_err');
					} else {
						try {
							var roomid = msg.data.roomid;
							var room = 'room:'+roomid;
							db.exists(room, check2err('room_not_exist',function(data){
								db.lpush(room, uid, check(function(count){
									if (count > MAX_ROOM_SIZE) {	// room is full
										db.ltrim(room, -MAX_ROOM_SIZE, -1);	// keep the first 4 users
										senderr('room_full_err');
									} else {
										db.set('roomid:'+uid, roomid, check(function(res){
											db.lrange(room, 0, -1, check(function(users){
												addRoomUid(roomid, uid);
												sendobj({room:{users:users}});
												roommsg(roomid, 'join', {uid:uid});
											}));
										}));
									}
								}));
							}));
						} catch (e) {
							senderr('msg_err');
						}
					}
				}));
				*/
			});
			break;
		case 'searchroom':
			//@cmd searchroom
			//@data mapid
			//@desc 加入随机房间（TODO）
			try {
				var mapid = msg.data.mapid;
				if (!mapid) {
					throw new Error();
				}
			} catch(e) {
				senderr('data_err');
				return;
			}

			getuser(function(user,uid){
				function doSearch () {
					db.hget('role:'+uid, 'Lv', check(function(lv){
						var searchstr = [uid, lv, mapid, Date.now()].toString();
						db.rpush('search_write', searchstr);
						sendnil();
					}));
				}

				db.exists('roomid:'+uid, check(function(exist){
					if (exist) {
						quitroom(uid, doSearch);
					} else {
						doSearch();
					}	
				}));
			});
			break;
		case 'quitroom':
			//@cmd quitroom
			//@desc 退出当前房间
			getuser(function(user,uid){
				quitroom(uid, function(uid,roomid){
					roommsg(roomid, 'quit');
					sendnil();
				});
			});

			break;
		case 'roomchat':
			//@cmd roomchat
			//@data msg
			//@desc 房间内聊天
			getuser(function(user,uid){
				db.get('roomid:'+uid, check2(function(roomid){
					sendnil();
					roommsg(roomid, 'chat', {ID:uid, msg:msg.data.msg});
				}));
			});
			break;
		case 'rename':
			//@cmd rename
			//@data nickname
			//@desc 更改昵称
			try {
				var newname = msg.data.nickname;
			} catch (e) {
				senderr('msg_err');
			}
			if (!newname) {
				senderr('nick_null_err');
			} else {
				getuser(function(user, uid) {
					// name already exists?
					// DON'T use SISMEMBER + SADD: ismember和add之间其他玩家可以进行操作
					db.sadd('nicknames', newname, check2err('nick_exist_err',function(){
						db.hset('role:'+uid, 'nickname', newname, check(function(res){
							sendobj({role:{nickname:newname}});
						}));
					}));
				});
			}
			break;
		case 'ADD_Equip':
			//@cmd ADD_Equip
			//@data id
			//@desc 生成随机装备
			try {
				var equipid = msg.data.id;
				var equip = new Equip(table, equipid);
			} catch (e) {
				senderr(e.message);
				return;
			}
			getuser(function(user,uid){
				db.incr('next_equip_id:'+uid, check2(function(index){
					var trans = new Transaction(db, uid);
					trans.hsetjson('equip', index, equip, check(function(){
						sendobj(trans.obj);
					}));
				}));
			});
			break;
		case 'ADD_GirlExp':
			//@cmd ADD_GirlExp
			//@data id
			//@data count
			//@desc 加战姬经验
			try {
				var girlid = msg.data.id;
				var expinc = parseInt(msg.data.count);
				if (isNaN(expinc)) {
					throw new Error('data_err'); 
				}
				getuser(function(user, uid){
					var query = ['Lv', 'GirlExp', 'Rank'];
					var girlkey = 'girl.'+girlid+':'+uid;
					db.hmget(girlkey, query, check2(function(data){
						if (data.length != query.length) {
							senderr('data_err');
						} else {
							var girl = new Girl(table);
							girl.Lv = data[0];
							girl.GirlExp = data[1];
							girl.Rank = data[2];
							try {
								var mod = girl.addExp(expinc);
								var trans = new Transaction(db, uid);
								trans.hmset('girl.'+girlid, mod, check(function(){
									sendobj(trans.obj);
								}));
							} catch (e) {
								senderr('girl_err');
							}
						}
					}));
				});
			} catch (e) {
				senderr('data_err:id,count');
				console.log(e);
				return;
			}

			break;
		case 'ADD_RoleExp':
			//@cmd ADD_RoleExp
			//@data count
			//@desc 加角色经验
			try {
				var expinc = parseInt(msg.data.count);
				if (isNaN(expinc)) {
					throw new Error('data_err'); 
				}
			} catch (e) {
				senderr('data_err:count');
				console.log(e);
				return;
			}
				
			getuser(function(user, uid){
				//we need Lv & RoleExp
				var query = ['Lv', 'RoleExp'];
				var trans = new Transaction(db, uid);
				db.hmget('role:'+uid, query, check2(function(data){
					if (data.length < query.length) {
						senderr('data_err');
					} else {
						var role = new Role(table);
						role.Lv = data[0];
						role.RoleExp = data[1];
						try {
							var mod = role.addExp(expinc);
							trans.hmset('role', mod, check(function(){
								sendobj(trans.obj);
							}));
						} catch (e) {
							senderr('role_err');
						}
					}
				}));
			});
			break;
		case 'ADD_Item':
			//@cmd ADD_Item
			//@data id
			//@data count
			//@desc 加物品
			getuser(function(user, uid){
				try {
					var itemid = msg.data.id;
					var count = msg.data.count;
					var trans = new Transaction(db, uid);
					if (itemid && count) {
						trans.hincrby('item', itemid, count, check(function(){
							sendobj(trans.obj);
						}));
					} else {
						senderr('data_err:id,count');
					}
				} catch (e) {
					senderr('data_err:id,count');
				}
			});
			break;
		case 'requestfriend':
			//@cmd requestfriend
			//@data target
			//@desc 求加好友（target为用户ID）
			//
			// <user> -> pendingfriends:<target>
			// tell target
			getuser(function(user, uid){
				try {
					var target = msg.data.target;
					if (target == uid) {	// try to be friend with oneself
						senderr('data_err');
						return;
					}
					db.sadd('pendingfriends:'+target, uid, check(function(){
						sendnil();
						var data = {};
						data.pendingfriends = {};
						data.pendingfriends[uid] = 1;
						notifymsg(target, {cmd:'view', data:data});
					}));
				} catch (e) {
					senderr('data_err:target');
				}
			});
			break;
		case 'delfriend':
			//@cmd delfriend
			//@data target
			//@desc 删除好友(target为用户ID)
			//
			// friends:<uid> -remove-> <target>
			// friends:<target> -remove-> <uid>
			// follow:<uid> -remove-> <target>
			// follow:<target> -remove-> <uid>
			// tell self
			// tell target
			getuser(function(user, uid){
				try {
					var target = msg.data.target;
					db.multi()
					.srem('friends:'+uid, target)
					.srem('friends:'+target, uid)
					.srem('follows:'+uid, target)
					.srem('follows:'+target, uid)
					.exec(checklist(4,function(){
						var userdata = {};
						userdata.friends = {};
						userdata.friends[target] = null;
						sendobj(userdata);

						var targetdata = {};
						targetdata.friends = {};
						targetdata.friends[uid] = null;
						notifymsg(target, {cmd:'view', data:targetdata});
					}));
				} catch (e) {
					senderr('data_err:target');
				}
			});
			break;
		case 'acceptfriend':
			//@cmd acceptfriend
			//@data target
			//@desc 接受好友请求
			//
			// pendingfriends:<user> -remove-> <target>
			// <target> -> friends:<user>
			// <user> -> friends:<target>
			// tell target
			getuser(function(user, uid){
				try {
					var target = msg.data.target;
					db.multi()
					.srem('pendingfriends:'+uid, target)
					.sadd('friends:'+uid, target)
					.sadd('friends:'+target, uid)
					.exec(checklist(3,function(){
						var userdata = {};
						userdata.pendingfriends = {};
						userdata.pendingfriends[target] = null;
						userdata.friends = {};
						userdata.friends[target] = 1;
						sendobj(userdata);

						var targetdata = {};
						targetdata.friends = {};
						targetdata.friends[uid] = 1;
						notifymsg(target, {cmd:'view', data:targetdata});
					}));
				} catch (e) {
					senderr('data_err:target');
				}
			});
			break;
		case 'declinefriend':
			//@cmd declinefriend
			//@data target
			//@desc 拒绝好友请求
			//
			// pendingfriends:<user> -remove-> <target>
			getuser(function(user, uid){
				try {
					var target = msg.data.target;
					db.srem('pendingfriends:'+uid, target, check2(function(){
						var userdata = {};
						userdata.pendingfriends = {};
						userdata.pendingfriends[target] = null;
						sendobj(userdata);
					}));
				} catch (e) {
					senderr('data_err,target');
				}
			});
			break;
		case 'followfriend':
			//@cmd followfriend
			//@data target 
			//@data follow
			//@desc 关注好友（follow=1：关注，follow=0：取消关注）
			getuser(function(user, uid){
				try {
					var target = msg.data.target;
					var follow = msg.data.follow;
				} catch (e) {
					senderr('data_err');
					return;
				}

				var obj = {};
				obj.follows = {};

				if (follow > 0) {
					db.sadd('follows:'+uid, target, check(function(){
						obj.follows[target] = 1;
						sendobj(obj);
					}));
				} else {
					db.srem('follows:'+uid, target, check(function(){
						obj.follows[target] = null;
						sendobj(obj);
					}));
				}
			});
			break;
		case 'friendbrief':
			//@cmd friendbrief
			//@data uids
			//@desc 好友简要信息（参数：uid$uid$uid...  返回:用户名 等级 队长 最后时间）
			getuser(function(user, uid){
				try {
					var uids = msg.data.uids.toString().split('$');
				} catch (e) {
					senderr('data_err:uids');
					return;
				}

				var cnt = 0;
				var obj = {friend:{}};
				uids.forEach(function(fid, i){
					db.hmget('role:'+fid, ['nickname', 'Lv', 'LastTime'], checklist(3, function(data){
						db.lindex('team.1:'+fid, 0, check(function(girlid){
							++cnt;
							obj.friend[fid] = {ID:fid, Nick:data[0], Lv:data[1], LastTime:data[2], Girl:girlid};

							if (cnt == uids.length) {	// done!
								sendobj(obj);
							}
						}));
					}));
				});
			});
			break;
		case 'frienddetail':
			//@cmd frienddetail
			//@data target
			//@desc 好友详细信息
			getuser(function(user, uid){
				try {
					var target = msg.data.target;
				} catch (e) {
					senderr('data_err');
					return;
				}

				// scoreboard / contribboard / girl
				var friend = {};
				var obj = {friend:{}};
				obj.friend[target] = friend;
				db.zrevrank('score', target, check(function(scorerank){
					friend.ScoreRank = scorerank;
					db.zrevrank('contrib', target, check(function(contribrank){
						friend.ContribRank = contribrank;
						db.lindex('team.1:'+target, 0, check(function(girlid){
							if (girlid) {
								db.hgetall('girl.'+girlid+':'+target, check(function(girl){
									friend.girl = {};
									friend.girl[girlid] = girl;
									sendobj(obj);
								}));
							} else {
								sendobj(obj);
							}
						}));
					}));
				}));
			});
			break;
		case 'usegift':
			//@cmd usegift
			//@data index
			//@desc 领取礼包
			getuser(function(user, uid){
				try {
					var giftidx = msg.data.index;
				} catch (e) {
					senderr('data_err');
					return;
				}
				db.hget('gift:'+uid, giftidx, check2err('gift_not_exist_err',function(jsonstr){
					var trans = new Transaction(db, uid);
					try {
						var json = JSON.parse(jsonstr);
						var gift = new Gift(json.ID);
						gift.use(table, function(type, id, num){
							trans.hdel('gift', giftidx, check2(function(){
								if (type == 'item') {
									db.hget('item:'+uid, id, check(function(count){	// check count limit
										count = Math.floor(count);
										if (count + num > table.item[id].Limit) {
											senderr('item_limit_err');
										} else {
											trans.hincrby('item', id, num, check2(function(newcount){
												sendobj(trans.obj);
											}));
										}
									}));
								} else if (type == 'equip') {
									db.hlen('equip:'+uid, check(function(count){	// check count limit
										count = Math.floor(count);
										if (count >= 999) {
											senderr('equip_limit_err');
										} else {
											db.incr('next_equip_id:'+uid, check(function(index){
												var equip = new Equip(table, id);
												trans.hsetjson('equip', index, equip, check(function(){
													sendobj(trans.obj);
												}));
											}));
										}
									}));
								} else if (type == 'girl') {
									addgirl(trans, uid, id);
								} else {
									// invalid gift
									sendobj(trans.obj);
								}
							}));
						});
					} catch (e) {
						senderr(e.message);
						return;
					}
				}));
			});
			break;
		case 'useallgifts':
			//@cmd useallgifts
			//@desc 领取全部礼包
			getuser(function(user,uid){
				db.get('next_gift_id:'+uid, check(function(next_gift_id){
					next_gift_id = Math.floor(next_gift_id);
					var next_equip_id = 0;

					db.hgetall('gift:'+uid, check(function(gifts){
						var girlmap = {};
						var allgirls = [];
						var addedgirls = [];
						var itemmap = {};
						var addedgifts = {};
						var delgifts = [];
						var giftres = {};
						var addequipcount = 0;
						var oldequipcount = 0;
						var addedequips = {};
						var itemcounts = {};
						var equipcount = 0;

						// find girls
						for (var index in gifts) {
							json = JSON.parse(gifts[index]);
							var gift = new Gift(json.ID);
							var res = gift.usesync(table);
							var id = res.id;
							if (res.type == 'girl') {
								girlmap[id] = girlmap[id] || 0;
								++girlmap[id];

								// gift items => used for redis query
								itemmap[12003] = 1;	//TODO
								itemmap[12004] = 1;

								delgifts.push(index);	// girl gift can always be used
							} else {	// store parsed gifts for later use
								if (res.type == 'equip') {
									++addequipcount;
								} else if (res.type == 'item') {
									itemmap[id] = itemmap[id] || 0;
									++itemmap[id];
								}
								giftres[index] = res;
							}
						}

						// process girl
						if (empty(girlmap)) {
							useallgifts();
						} else {
							db.smembers('girls:'+uid, check(function(girls){
								for (var girlid in girlmap) {
									var ismember = girls.indexOf(girlid) != -1;
									if (!ismember) {	// add girl
										addedgirls.push(girlid);

										++next_gift_id;
										var gift = new Gift(GIRL_GIFT);
										giftres[next_gift_id] = gift.usesync(table);
										addedgifts[next_gift_id] = gift;
									}
									if (ismember || girlmap[girlid] > 1) {	// add gift
										var count = girlmap[girlid] - 1;
										if (ismember) {
											++count;
										}
										for (var i=0; i<count; i++) {
											var gift = new Gift(SAME_GIRL_GIFT);
											++next_gift_id;
											giftres[next_gift_id] = gift.usesync(table);
											addedgifts[next_gift_id] = gift;
										}
									}
								}
								for (var i in addedgirls) {
									girls.push(addedgirls[i]);
								}
								allgirls = girls;
								useallgifts();
							}));
						}
						
						function useallgifts () {
							// check count limit
							var itemarr = [];
							for (var i in itemmap) {
								itemarr.push(i);
							}

							if (itemarr.length>0) {
								db.hmget('item:'+uid, itemarr, check(function(counts){
									for (var j=0; j<itemarr.length; j++) {
										itemcounts[itemarr[j]] = Math.floor(counts[j]);
									}
									checkequip();
								}));
							} else {
								checkequip();
							}
						}

						function checkequip () {
							// get item counts
							if (addequipcount > 0) {
								db.hlen('equip:'+uid, check(function(count){
									equipcount = count;

									db.get('next_equip_id:'+uid, check(function(nextid){
										next_equip_id = Math.floor(nextid);
										douse();
									}));
								}));
							} else {
								douse();
							}
						}

						function douse () {						
							var oldequipcount = equipcount;
							for (var index in giftres) {
								var res = giftres[index];
								var id = res.id;
								var del = true;
								if (res.type == 'item') {	// items
									if (itemcounts[id] + res.num <= table.item[id].Limit) {	// used gift => incr item:<uid> index
										itemcounts[id] += res.num;			// hmset item:<uid> itemcounts
									} else {
										del = false;
									}
								} else if (res.type == 'equip') {	// equips
									if (equipcount < 999) {
										++equipcount;
										++next_equip_id;
										addedequips[next_equip_id] = new Equip(table, res.id);
									} else {
										del = false;
									}
								}
								if (del) {
									if (addedgifts.hasOwnProperty(index)) {	// added & used
										delete addedgifts[index];
									} else {
										delgifts.push(index);
									}
								}
							}

							// save db
							var trans = new Transaction(db, uid);
							var multi = trans.multi();

							// girls
							if (addedgirls.length > 0) {
								for (var i in addedgirls) {
									var girl = new Girl;
									var girlid = addedgirls[i];
									girl.newGirl(table, girlid);
									multi.hmset('girl.'+girlid, girl);
								}
								multi.sadd('girls', addedgirls);
								trans.client().set('girls', allgirls);
							}
	
							// items
							if (!empty(itemcounts)) {
								multi.hmset('item', itemcounts);
							}

							// equips
							if (equipcount > oldequipcount) {
								for (var index in addedequips) {
									multi.hsetjson('equip', index, addedequips[index]);
								}
								multi.server().set('next_equip_id', next_equip_id);
							}

							// deleted gifts
							if (delgifts.length > 0) {
								multi.hdel('gift', delgifts);
							}
							
							// added gifts
							if (!empty(addedgifts)) {
								multi
								.hmsetjson('gift', addedgifts)
								.server().set('next_gift_id', next_gift_id);
							}

							// done
							multi.exec(function(){
								sendobj(trans.obj);
							});
						}

						// used gifts			=> remove db
						// unused gifts			=>
						// added & used gifts	=> add result to db
						// added & unused gifts => add db

					}));

				}));
			});
			break;
		case 'useitem':
			//@cmd useitem
			//@data itemid
			//@data targetid
			//@desc 使用物品(targetid可以是girl的id之类的值)
			getuser(function(user, uid){
				try {
					var itemid = msg.data.itemid;
					var item = table.item[itemid];
					if (item.Type == 1) {
						var girlid = msg.data.targetid;
					}
				} catch (e) {
					senderr('data_err,itemid');
					return;
				}
				var itemkey = 'item:'+uid;
				db.hget(itemkey, itemid, check(function(count){
					if (!count || count <= 0) {
						senderr('no_item_err');
						return;
					}
					switch (item.Type) {
						case 1:	//medal
							if (item.Effect == 1 && girlid) {
								var query = ['Rank', 'RankExp'];
								var girlkey = 'girl.'+girlid+':'+uid;
								db.hmget(girlkey, query, checklist(2,function(data){
									var girl = new Girl(table);
									girl.Rank = data[0];
									girl.RankExp = data[1];
									try {
										var modgirl = girl.addRankExp(item.EffectValue);
										var trans = new Transaction(db, uid);
										var multi = trans.multi();
										if (count > 1) {
											multi.hincrby('item', itemid, -1);
										} else {
											multi.hdel('item', itemid);
										}
										multi
										.hmset('girl.'+girlid, modgirl)
										.exec(checklist(2,function(res){
											sendobj(trans.obj);
										}));
									} catch (e) {
										senderr('data_err');
									}
								}));
							} else {
								senderr('data_err1');
							}
							break;
						case 2:	//multiply
							var trans = new Transaction(db, uid);
							var iteminfo = {ID: itemid, Begin:Date.now()};
							var timeout = table.item[itemid].EffectValue;
							var multi = trans.multi();
							if (count > 1) {
								multi.hincrby('item', itemid, -1);
							} else {
								multi.hdel('item', itemid);
							}
							multi
							.hmset('activeitem', iteminfo)
							.expire('activeitem', timeout)
							.exec(checklist(3,function(res){
								// set timeout for client use
								trans.client().hmset('activeitem', {ID: itemid, Timeout: timeout * 1000});
								sendobj(trans.obj);
							}));
							break;
						case 3:	//wuxing
							senderr('cannot_use_item_err');
							break;
					}
				}));
			});
			break;
		case 'getactiveitem':
			//@cmd getactiveitem
			//@desc 获取当前正在使用的道具{ID:id Timeout:ms}
			getuser(function(user, uid) {
				db.hgetall('activeitem:'+uid, check(function(data){
					var trans = new Transaction(db, uid);
					if (data) {
						var elapsed = Date.now() - data.Begin;
						var life = table.item[data.ID].EffectValue * 1000;
						data.Timeout = life - elapsed;
						trans.client().hmset('activeitem', data);
						sendobj(trans.obj);
					} else {
						sendobj({activeitem:null});
					}	
				}));
			});
			break;
		case 'sellitem':
			//@cmd sellitem
			//@data itemid
			//@data count
			//@desc 卖道具
			getuser(function(user, uid){
				try {
					var itemid = msg.data.itemid;
					var count = msg.data.count;
					var credit = count * table.item[itemid][12000];
				} catch (e) {
					senderr('data_err');
					return;
				}
				db.hget('item:'+uid, itemid, check2(function(nowcount){
					var trans = new Transaction(db, uid);
					if (count < nowcount) {
						var multi = trans.multi();
						multi.hincrby('item', itemid, -count)
					} else if (count == nowcount) {
						var multi = trans.multi();
						multi.hdel('item', itemid)
					} else {
						senderr('not_enough_item_err');
						return;
					}
					multi
					.hincrby('item', 12000, credit)
					.exec(checklist(2,function(data){
						sendobj(trans.obj);
					}));
				}));
			});
			break;
		case 'buyitem':
			//@cmd buyitem
			//@data shopid
			//@data itemid
			//@desc 买物品
			getuser(function(user, uid){
				// cost
				try {
					var money = msg.data.shopid;
					var itemid = msg.data.itemid;
					if (money < 12000 || money > 12003) {
						senderr('wrong_shop_err');
						return;
					}

					db.hget('item:'+uid, money, check(function(count){
						var cost = table.item[itemid][money];
						if (cost > count) {
							senderr('not_enough_item_err');
						} else {
							var trans = new Transaction(db, uid);
							trans.multi()
							.hincrby('item', money, -cost)
							.hincrby('item', itemid, 1)
							.exec(checklist(2,function(res){
								sendobj(trans.obj);
							}));
						}
					}));
				} catch (e) {
					senderr('data_err:shopid,itemid');
				}
			});
			break;
		case 'buygirl':
			//@cmd buygirl
			//@data item
			//@desc 姬娘扭蛋（item格式为{id1:count...idN:count}）
			getuser(function(user, uid){
				// cost
				var mod = {};
				db.hget('item:'+uid, 12001, check(function(photon){
					if (photon < GIRL_PRICE) {
						senderr('not_enough_item_err');
					} else {
						// used items
						try {
							var itemcounts = msg.data.item;
							if (itemcounts && empty(itemcounts)) {
								itemcounts = null;
							}
						} catch (e) {
							itemcounts = null;
						}

						var idlist = [];
						var trans = new Transaction(db, uid);
						if (itemcounts) {
							for (var itemid in itemcounts) {
								idlist.push(itemid);
							}
							db.hmget('item:'+uid, idlist, check(function(countlist){

								//enough items?
								var remaincount = {};
								for (var i=0; i<idlist.length; i++) {
									var id = idlist[i];
									var remain = countlist[i] - itemcounts[id];
									if (remain < 0) {
										senderr('not_enough_item_err');
										return;
									}

									remaincount[id] = remain;
								}

								trans.hmset('item', itemcounts, check(function(){
									try {
										addgirl(trans, uid, buygirl(), GIRL_PRICE);
									} catch (e) {
										senderr('buygirl_err');
									}
								}));
							}));
						} else {
							try {
								addgirl(trans, uid, buygirl(), GIRL_PRICE);
							} catch (e) {
								senderr('buygirl_err');
							}
						}

						function buygirl() {
							var newGirl = new Girl();
							return newGirl.buyGirl(table, itemcounts);
						}
					}
				}));
				// random
			});
			break;
		case 'setteam':
			//@cmd setteam
			//@data girlid
			//@data teamid
			//@data pos
			//@desc 设置战姬所属编队(teamid:0-5; 0=>no team)和位置(pos:0-3; index to array)
			//TODO: cost cap
			getuser(function(user,uid){
				/*
				 * find target team & pos
				 * swap
				 */
				try {
					// _s : source, _t : target
					var girl_s = msg.data.girlid;
					var team_t = Math.floor(msg.data.teamid);
					var pos_t = Math.floor(msg.data.pos);
					if (team_t<0 || team_t>5) {
						throw new Error('invalid_team');
					}
					if (pos_t<0 || pos_t>3) {
						throw new Error('invalid_pos');
					}
				} catch (e) {
					senderr('data_err');
					console.log(e);
					return;
				}
				db.hmget('girl.'+girl_s+':'+uid, ['ID','Team'], checklist(2,function(girl){
					var ID = girl[0];
					var team_s = girl[1];
					if (ID != girl_s) {
						senderr('data_err');
						return;
					}
					var trans = new Transaction(db, uid);

					// s->0
					if (team_t == 0) {
						if (team_s > 0) {	// s->0
							db.llen('team.'+team_s+':'+uid, check(function(len){
								if (len <= 1) {
									senderr('empty_team_err');
								} else {
									trans.multi()
									.lrem('team.'+team_s, 0, girl_s)
									.lrange('team.'+team_s,0,-1)		// update old list
									.hset('girl.'+girl_s, 'Team', 0)	// set Team to 0
									.exec(check(function(){
										sendobj(trans.obj);
									}));
								}
							}));
						} else {	// else 0->0
							sendnil();
						}
					} else {
						db.lrange('team.'+team_t+':'+uid, 0, -1, check(function(list_t){
							if (pos_t >= list_t.length) {	// s->t0
								// IMPORTANT: must use girl_s.toString(): list_t is a array of string, and girl_s is int
								var s_pos_t = list_t.indexOf(girl_s.toString());	// src pos in target list
								if (s_pos_t != -1) {	// s->s0	=> move to the end of the list
									if (s_pos_t == list_t.length-1) {	// already the last => do nothing
										sendnil();
									} else {
										trans.multi()
										.lrem('team.'+team_t, 0, girl_s)
										.rpush('team.'+team_t, girl_s)
										.lrange('team.'+team_t, 0, -1)
										.exec(check(function(){
											sendobj(trans.obj);
										}));
									}
								} else {
									if (team_s > 0) {	// remove from source list
										db.llen('team.'+team_s+':'+uid, check(function(len){
											if (len <= 1) {
												senderr('empty_team_err');
											} else {
												trans.multi()
												.lrem('team.'+team_s, 0, girl_s)	// remove from src list
												.lrange('team.'+team_s, 0, -1)
												.rpush('team.'+team_t, girl_s)	// s->t0
												.lrange('team.'+team_t,0,-1)
												.hset('girl.'+girl_s, 'Team', team_t)
												.exec(check(function(){
													sendobj(trans.obj);
												}));
											}
										}));
									} else {
										trans.multi()
										.rpush('team.'+team_t, girl_s)	// s->t0
										.lrange('team.'+team_t,0,-1)
										.hset('girl.'+girl_s, 'Team', team_t)
										.exec(check(function(){
											sendobj(trans.obj);
										}));
									}
								}
							} else {	// swap
								var girl_t = list_t[pos_t];
								if (team_s > 0) {	// s->t
									db.lrange('team.'+team_s+':'+uid, 0, -1, check(function(list_s){
										//IMPORTANT
										var pos_s = list_s.indexOf(girl_s.toString());
										trans.multi()
										.lset('team.'+team_t, pos_t, girl_s)	// sg->t
										.lset('team.'+team_s, pos_s, girl_t)	// tg->s
										.hset('girl.'+girl_t, 'Team', team_s)	// st->tg
										.hset('girl.'+girl_s, 'Team', team_t)	// tt->sg
										.exec(check(function(){
											if (team_s == team_t) {	// same team swap
												list_s[pos_t] = girl_s;
												list_s[pos_s] = girl_t;
												trans.client().set('team.'+team_s, list_s);
											} else {
												list_t[pos_t] = girl_s;
												list_s[pos_s] = girl_t;
												trans.client().set('team.'+team_t, list_t);
												trans.client().set('team.'+team_s, list_s);
											}
											sendobj(trans.obj);
										}));
									}));
								} else {	// 0->t
									trans.multi()
									.lset('team.'+team_t, pos_t, girl_s)	// sg->t
									.hset('girl.'+girl_t, 'Team', 0)		// 0->tg
									.hset('girl.'+girl_s, 'Team', team_t)	// tt->sg
									.exec(check(function(){
										list_t[pos_t] = girl_s;
										trans.client().set('team.'+team_t, list_t);
										sendobj(trans.obj);
									}));
								}
							}
						}));
					}
				}));
			});
			break;
		case 'view':
			//@cmd view
			//@data name
			//@data id
			//@desc 查看数据：role girl room items girls friends pendingfriends follows team equip allgift（girl/team/equip需要用到id; allgift返回的是gift:{id:{ID Time}}）
			getuser(function(user, id){
				var viewname = msg.data.name;
				var trans = new Transaction(db, id);
				switch (viewname) {
					case 'role':
						trans.hgetall('role', check2(function(role){
							sendobj(trans.obj);
						}));
						break;
					case 'girl':
						trans.hgetall('girl.'+msg.data.id, check2(function(girl){
							sendobj(trans.obj);
						}));
						break;
					case 'girls':
						trans.smembers('girls', check2(function(girls){
							sendobj(trans.obj);
						}));
						break;
					case 'room':
						db.get('roomid:'+id, check(function(roomid){
							if (roomid) {
								db.lrange('room:'+roomid, 0, -1, check(function(room){
									db.get('recruitinfo:'+roomid, check(function(recruitstr){
										sendobj({room:{roomid:roomid, userid:room}, role:{Recruit:recruitstr}});
									}));
								}));
							} else {
								sendobj({room:null});
							}
						}));
						break;
					case 'roommates':
						// role:<uid> {RoomTeam, Lv, Nick}
						// team.<role.RoomTeam>:<uid> -> [girlId1, girlId2, ...] -> girl.<girlId>:<uid>
						try {
							var uids = msg.data.id.toString().split('$');
						} catch (e) {
							senderr('data_err');
							return;
						}
						var cnt = 0;
						var mates = {};
						uids.forEach(function(uid, i){
							// get role 
							db.hmget('role:'+uid, ['RoomTeam', 'Lv', 'Nick'], checklist(3, function(data){
								var mate = new Teammate(uid);
								mates[uid] = mate;
								mate.initRole(data);

								function finish () {
									++cnt;
									if (cnt == uids.length) {
										sendobj({roommate:mates});
									}
								}

								// get team
								if (mate.role.RoomTeam) {
									db.lrange('team.'+mate.role.RoomTeam+':'+uid, 0, -1, check(function(team){
										if (team.length > 0) {
											mate.initTeam(team);

											// get girls
											var girlcnt = 0;
											team.forEach(function(girlId, j){
												db.hgetall('girl.'+girlId+':'+uid, check(function(girl){
													++girlcnt;
													mate.addGirl(girl);

													if (girlcnt == team.length) {
														finish();
													}
												}));
											});
										} else {	// empty team
											finish();
										}
									}));
								} else {	// no team
									finish();
								}
							}));
						});
						break;
					case 'item':
						trans.hgetall('item', check(function(item){
							sendobj(trans.obj);
						}));
						break;
					case 'friends':
					case 'pendingfriends':
					case 'follows':
						db.smembers(viewname+':'+uid, check(function(friendset){
							var userdata = {};
							userdata[viewname] = friendset; //friends;
							sendobj(userdata);
						}));
						break;
					case 'team':
						trans.lrange('team.'+msg.data.id,0,-1,check(function(){
							sendobj(trans.obj);
						}));
						break;
					case 'equip':
						trans.hgetjson('equip', msg.data.id, check(function(){
							sendobj(trans.obj);
						}));
						break;
						/*
					case 'gift':
						trans.hgetjson('gift', msg.data.id, check(function(){
							sendobj(trans.obj);
						}));
						break;
						*/
					case 'allgift':
						trans.hgetalljson('gift', check(function(){
							sendobj(trans.obj);
						}));
						break;
				}
			});
			break;
		case 'reg':
			//@cmd reg
			//@data user
			//@data pass
			//@nosession
			//@desc 注册用户
			var user = msg.data.user;
			var pass = msg.data.pass;
			if (!pass) {
				senderr('empty_pass_err');
			} else {
				db.sadd('usernames', user, check2err('user_exist',function(){
					db.multi()
					.incr('next_account_id')
					.set('user:'+user, pass)
					.exec(checklist(2,function(res){
						var uid = res[0];
						db.set('account:'+user+':id', uid, check2(function(){
							// create role
							var newRole = new Role();
							newRole.newRole(uid);
							db.hmset('role:'+uid, newRole, check(function(){
								sendnil();
							}));
						}));
					}));
				}));
			}
			break;
		case 'login':
			//@cmd login
			//@data user
			//@data pass
			//@nosession
			//@desc 登录
			try {
				var user = msg.data.user;
				var pass = msg.data.pass;
			} catch (e) {
				senderr('msg_err');
				return;
			}
			
			// user/pass valid?
			db.get('user:'+user, check2err('user_not_exist', function(storedpass){
				if (pass != storedpass) {
					senderr('pass_err');
				} else {
					db.get('account:'+user+':id', check2(function(uid){

						// session exist - multiple logins
						db.get('session:'+uid, check(function(oldsess){
							var ok = true;
							if (oldsess) {
								// kick the prev user
								var prevws = uid2ws[uid];
								if (prevws) {	// same machine
									if (prevws != ws) {
										// kick
										prevws.close(4001);
										removeWs(prevws);
									} else {
										senderr('already_loggedin_err');
										ok = false;
									}
								} else {
									kickmsg(uid);
								}
							} 
							if (ok) {
								generateSession(function(session){
									// destroy previous sessionuser
									db.getset('session:'+uid, session, check(function(oldsession){
										db.multi()
										.del('sessionuser:'+oldsession)
										.set('sessionuser:'+session, user)
										.exec(checklist(2,function(res){
											uid2ws[uid] = ws;
											ws2uid[ws] = uid;
											sendobj({session:session});

											// in a room?
											/*
											db.get('roomid:'+uid, check(function(roomid){
												addRoomUid(roomid, uid);
											}));
											*/
										}));
									}));
								});	
							}
						}));
					}));
				}
			}));
			break;
		}
	});
});

wss.broadcast = function broadcast(data) {
  for(var i in this.clients) {
    this.clients[i].send(data);
  }
}

wss.kick = function (uid) {
	var ws = uid2ws[uid];
	if (ws) {
		ws.close();
		removeWs(ws);
	}
}

wss.notify = function (uid, datastr) {
	var ws = uid2ws[uid];
	if (ws) {
		ws.send(datastr);
	}
}

wss.sendcmd = function (uid, cmd) {
	var ws = uid2ws[uid];
	if (ws) {
		ws.send(JSON.stringify({cmd:cmd}));
	}
}

wss.sendobj = function (uid, cmd, obj) {
	var ws = uid2ws[uid];
	if (ws) {
		try {
			var datastr = JSON.stringify({cmd:cmd, data:obj});
			ws.send(datastr);
		} catch (e) {
		}
	}
}

process.on('SIGINT', function() {
	for(var i in wss.clients) {
		wss.clients[i].close(4002);
	}
	process.exit();
});
//}	// end else cluster

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
var userpub = redis.createClient();
var usersub = redis.createClient();
var roompub = redis.createClient();
var roomsub = redis.createClient();
var db = redis.createClient();
var table = require('./table.json');
var GIRL_PRICE = 100;

console.log("Server started");
var port = parseInt(process.argv[2]);
var WebSocketServer = require('ws').Server;
var wss = new WebSocketServer({port: port});
var user2ws = {};	// user->ws
var ws2user = {};
var appid = randomString(32);
var room2user = {};

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

function responseData (ws, cmd, data, id) {
	if (cmd != 'view') {
		response(ws, 'view', data);
		response(ws, cmd, '', id);
	} else {
		response(ws, 'view', data, id);
	}
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

usersub.subscribe('user');
usersub.on('message', function(channel, message){
	try {
		var msg = JSON.parse(message);
	} catch(e) {
		msg = {};
		console.log(e);
	}
	switch (msg.cmd) {
	case 'kick':
		if (msg.appid != appid) {	// invoked by other server
			wss.kick(msg.user);
		}
		break;
	}
});

function addRoomUser (roomid, user) {
	room2user[roomid] = room2user[roomid] || {};
	room2user[roomid][user] = 1;
}

function delRoomUser (roomid, user) {
	if (room2user[roomid]) {
		delete room2user[roomid][user];
	}
}

roomsub.psubscribe('room.*');	//psubscribe -> pmessage
roomsub.on('pmessage', function(pattern, channel, message){
	var roomid = channel.split('.')[1];
	
	// find users in the room
	var users = room2user[roomid];
	if (users) {
		try {
			var msg = JSON.parse(message);
			var broadcast = function (cmd,data) {
				var datastr = JSON.stringify({cmd:cmd,data:data});
				for(var user in users) {
					var ws = user2ws[user];
					if (ws) {
						ws.send(datastr);
					}
				}
			}
		} catch(e) {
			msg = {};
		}

		switch (msg.cmd) {
		case 'sync':	// sync properties with other players
		case 'chat':
		case 'quit':
		case 'join':
			broadcast(msg.cmd, msg.data);
			break;
		case 'kill':
			delete room2user[roomid];
			break;
		}
	}
});

function removeWs (ws) {
	var user = ws2user[ws];
	if (user) {
		delete ws2user[ws];
		delete user2ws[user];
	}
}

function roommsg (roomid, cmd, data) {
	publishData(roompub, 'room.'+roomid, {cmd:cmd, data:data});
}

var MAX_ROOM_SIZE = 4;

wss.on('connection', function(ws) {
	ws.on('open', function() {
		
	});

	ws.on('close', function(code, message) {
		var user = ws2user[ws];
		db.get('session:'+user, function(err, sess) {
			if (user) {
				if (code == 4001) {	// kick. code 4000-4999 can be used by application.
					console.log('kick', sess);
				} else {
					console.log('close');
					delete user2ws[user];
					db.del('session:'+user, 'sessionuser:'+sess);
				}
			}
		});
		delete ws2user[ws];
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
			responseData(ws, msg.cmd, data, msg.id);
		}

		function sendnil () {
			response(ws, msg.cmd, '', msg.id);
		}

		switch(msg.cmd) {
		case 'echo': 
			sendobj(msg.data);
			break;
		case 'makeroom':
		case 'joinroom':
		case 'randroom':
		case 'quitroom':
		case 'chat':
		case 'sync':
			getuser(function(user){
				db.get('roomid:'+user, check(function(roomid){
					if (roomid) {	// room exists
						if (msg.cmd=='quitroom') {
							db.llen('room:'+roomid, check(function(len){
								if (len<2) { // destroy the room if it's empty
									db.multi()
									.del('room:'+roomid)
									.del('roomid:'+user)
									.exec(check(function(){
										roommsg(roomid, 'kill');
										sendobj({room:null});
									}));
								} else { // tell others that I left the room
									db.multi()
									.del('roomid:'+user)
									.lrem('room:'+roomid, 1, user)
									.exec(check(function(){
										roommsg(roomid, 'quit', {user:user});
										delRoomUser(roomid, user);
									}));
								}
							}));
						} else if (msg.cmd=='chat') {
							roommsg(roomid, 'chat', {user:user, msg:msg.data.msg});
						} else if (msg.cmd=='sync') {
							roommsg(roomid, 'sync', {user:user, data:msg.data});
						} else {
							senderr('already_in_room_err');
						}
					} else {	// room does not exist
						if (msg.cmd=='makeroom') {
							db.incr('next_room_id', check2(function(newid){
								db
								.multi()
								.set('roomid:'+user, newid)
								.lpush('room:'+newid, user)
								.exec(check(function(data){
									addRoomUser(newid, user);
									sendobj({room:{roomid:newid, users:[user]}});
								}));
							}));
						} else if (msg.cmd=='joinroom') {
							try {
								var roomid = msg.data.roomid;
								var room = 'room:'+roomid;
								db.exists(room, check2err('room_not_exist',function(data){
									db.lpush(room, user, check(function(count){
										if (count > MAX_ROOM_SIZE) {	// room is full
											db.ltrim(room, -MAX_ROOM_SIZE, -1);	// keep the first 4 users
											senderr('room_full_err');
										} else {
											db.set('roomid:'+user, roomid, check(function(res){
												db.lrange(room, 0, -1, check(function(users){
													addRoomUser(roomid, user);
													sendobj({room:{users:users}});
													roommsg(roomid, 'join', {user:user});
												}));
											}));
										}
									}));
								}));
							} catch (e) {
								senderr('msg_err');
							}
						} else if (msg.cmd=='randroom'){
							// get a random* room with available seats
							senderr('not_impl_err');
						} else {
							senderr('not_in_room_err');
						}
					}
				}));
			});
			break;
		case 'rename':
			try {
				var newname = msg.data.nickname;
			} catch (e) {
				senderr('msg_err');
			}
			if (!newname) {
				senderr('nick_null_err');
			} else {
				getuser(function(user, userid) {
					// name already exists?
					// DON'T use SISMEMBER + SADD: ismember和add之间其他玩家可以进行操作
					db.sadd('nicknames', newname, check2err('nick_exist_err',function(){
						db.hset('role:'+userid, 'nickname', newname, check(function(res){
							sendobj({role:{nickname:newname}});
						}));
					}));
				});
			}
			break;
		case 'ADD_PHOTON':
			getuser(function(user, userid){
				try {
					var count = msg.data.count;
				} catch(e) {
					count = 100;
				}
				db.hincrby('role:'+userid, 'photon', count, check(function(){
					sendnil();
				}));
			});
			break;
		case 'ADD_ITEM':
			getuser(function(user, userid){
				try {
					var itemid = msg.data.id;
					var count = msg.data.count;
					db.hincrby('item:'+userid, itemid, count, check(function(){
						sendnil();
					}));
				} catch (e) {
				}
			});
			break;
		case 'buyitem':
			getuser(function(user, userid){
				// cost
				
			});
			break;
		case 'buygirl':
			getuser(function(user, userid){
				// cost
				db.hget('role:'+userid, 'photon', check(function(photon){
					if (photon < GIRL_PRICE) {
						senderr('not_enough_photon_err');
					} else {
						// used items
						try {
							var itemcounts = msg.data.item;
						} catch (e) {
							itemcounts = null;
						}
						var odds = [20, 20, 20, 20, 20];
						var dobuy = function () {
							// which wuxing?
							var rand = Math.floor(Math.random()*100);
							for (var wx=0; wx<5; wx++) {
								rand -= odds[wx];
								if (rand<0) {
									break;
								}
							}
							wx += 1;

							// rare
							// 4: 1.5%
							// 3: 28.5%
							// 2: 70%
							rand = Math.random()*100;
							var rare = 1;
							if (rand < 1.5) {
								rare = 4;
							} else if (rand < 28.5) {
								rare = 3;
							} else {
								rare = 2;
							}

							// find all suitable girls 
							var wxgirls = [];
							var matchgirls = [];
							for (var g in table.girl) {
								if (table.girl[g].Wuxing == wx) {
									wxgirls.push(table.girl[g]);
									if (table.girl[g].Rare == rare) {
										matchgirls.push(table.girl[g]);
									}
								}
							}

							if (matchgirls.length > 0) {	// found
								var girl = matchgirls[Math.floor(Math.random()*matchgirls.length)];
							} else {
								var girl = wxgirls[Math.floor(Math.random()*matchgirls.length)];
							}
							// already exist?
							db.sismember('girls:'+userid, girl.ID, check(function(exist){
								if (exist) {
									// convert to medal
									var medalid = 12000 + rare;
									db.hincrby('item:'+userid, medalid, 10, check(function(count){
										var itemdata = {};
										itemdata[medalid] = count;
										sendobj({item:itemdata});
									}));
								} else {
									db.sadd('girls:'+userid, girl.ID, check(function(){
										db.hmset('girl:'+userid+':'+girl.ID, girl, check(function(){
											var girldata = {};
											girldata[girl.ID] = girl;
											sendobj({girl:girldata});
										}));
									}));
								}
							}));
						}
						if (itemcounts) {
							var idlist = [];
							for (var itemid in itemcounts) {
								idlist.push(itemid);
							}
							db.hmget('item:'+userid, idlist, check(function(countlist){
								for (var i in idlist) {
									var id = idlist[i];
									var cost = itemcounts[id];
									if (cost > countlist[i]) {
										senderr('not_enough_item_err');
										return;
									} else {
										itemcounts[id] = countlist[i] - cost;
										var effect = table.item[id].Effect;
										if ( effect >= 5 && effect <= 9) {
											var effval = table.item[id].EffectValue;
											var incdec = effval.split('$');
											for (var j=0; j<5; j++) {
												if (j == effect-5) {
													odds[j] += incdec[0];
												} else {
													odds[j] -= incdec[1];
												}
											}											
										}
									}
								}

								db.hmset('item:'+userid, itemcounts, check(function(){
									dobuy();
								}));
							}));
						} else {
							dobuy();
						}
					}
				}));
				// random
			});
			break;
		case 'view':
			getuser(function(user, id){
				switch (msg.data.name) {
					case 'role':
						db.hgetall('role:'+id, check(function(role){
							if (role) {
								sendobj({role:role});
							} else {
								// create role
								var newRole = {
									level:1, 
							exp:0, 
							nickname:'', 
							id:id, 
							gold:0, 
							diamond:0, 
							cost:0, 
							redeem:''
								};
								db.hmset('role:'+id, newRole, check(function(data){
									sendobj({role:newRole});
								}));
							}
						}));
						break;
					case 'girl':
						db.hgetall('girl:'+id+':'+msg.data.id, check2(function(girl){
							var girldata = {};
							girldata[girl.ID] = girl;
							sendobj({girl:girldata});
						}));
						break;
					case 'room':
						db.get('roomid:'+user, check(function(roomid){
							if (roomid) {
								db.lrange('room:'+roomid, 0, -1, check(function(room){
									sendobj({room:{roomid:roomid, users:room}});
								}));
							} else {
								sendobj({room:null});
							}
						}));
						break;
					case 'item':
						db.hgetall('item:'+id, check2(function(item){
							sendobj({item:item});
						}));
						break;
				}
			});
			break;
		case 'reg':
			var user = msg.data.user;
			var pass = msg.data.pass;
			if (!pass) {
				senderr('empty_pass_err');
			} else {
				db.sadd('usernames', newname, check2err('user_exist',function(){
					db.multi()
					.incr('next_account_id')
					.set('user:'+user, pass)
					.exec(check(function(res){
						db.set('account:'+user+':id', res[0], check2(function(){
							sendnil();
						}));
					}));
				}));
			}
			break;
		case 'login':
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
					// session exist - multiple logins
					db.get('session:'+user, check(function(oldsess){
						var ok = true;
						if (oldsess) {
							// kick the prev user
							var prevws = user2ws[user];
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
								publishData(userpub, 'user', {cmd:'kick', user:user, appid:appid});
							}
						} 
						if (ok) {
							generateSession(function(session){
								// destroy previous sessionuser
								db.getset('session:'+user, session, check(function(oldsession){
									db.multi()
									.del('sessionuser:'+oldsession, session)
									.set('sessionuser:'+session, user)
									.exec(check(function(res){
										user2ws[user] = ws;
										ws2user[ws] = user;
										sendobj({session:session});

										// in a room?
										db.get('roomid:'+user, check(function(roomid){
											addRoomUser(roomid, user);
										}));
									}));
								}));
							});	
						}
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

wss.kick = function (user) {
	var ws = user2ws[user];
	if (ws) {
		ws.close();
		removeWs(ws);
	}
}

process.on('SIGINT', function() {
	for(var i in wss.clients) {
		wss.clients[i].close(4002);
	}
	process.exit();
});
//}	// end else cluster

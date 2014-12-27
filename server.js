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
var redisclient = redis.createClient();

console.log("Server started");
var port = parseInt(process.argv[2]);
var WebSocketServer = require('ws').Server;
var wss = new WebSocketServer({port: port});
var user2ws = {};	// user->ws
var ws2user = {};
var appid = randomString(32);
var room2user = {};

function response (ws, cmd, data, id) {
	var resp = {};
	resp.cmd = cmd;
	resp.data = data;
	if (id) {
		resp.id = id;
	}
	ws.send(JSON.stringify(resp));
}

function responseErr (ws, cmd, err, id) {
	var resp = {};
	resp.cmd = cmd;
	resp.err = err;
	if (id) {
		resp.id = id;
	}
	ws.send(JSON.stringify(resp));
}

function responseData (ws, cmd, data, id) {
	response(ws, 'view', data);
	response(ws, cmd, '', id);
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

function delRoom (roomid) {
	delete room2user[roomid];
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
		redisclient.get('session:'+user, function(err, sess) {
			if (user) {
				if (code == 4001) {	// kick. code 4000-4999 can be used by application.
					console.log('kick', sess);
				} else {
					console.log('close');
					delete user2ws[user];
					redisclient.del('session:'+user, 'sessionuser:'+sess);
				}
			}
		});
		delete ws2user[ws];
	});

	ws.on('message', function(message) {
		try {
			var msg = JSON.parse(message);
		} catch (e) {
			msg = {};
		}

		var getuser = function (cb) {
			var session = msg.session;
			if (session) {
				redisclient.get('sessionuser:'+session, function(err, user) {
					if (err || !user) {
						responseErr(ws, msg.cmd, 'session_err', msg.id);
					} else {
						if (typeof cb == 'function') {
							cb(user);
						}
					}
				});
			} else {
				responseErr(ws, msg.cmd, 'session_err', msg.id);
			}
		}

		var check = function (cb) {
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

		var check2 = function (cb) {
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

		var check2err = function (errmsg, cb) {
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

		var senderr = function (errmsg) {
			responseErr(ws, msg.cmd, errmsg, msg.id);
		}

		var sendstr = function (text) {
			response(ws, msg.cmd, text, msg.id);
		}

		var send = function (data) {
			responseData(ws, msg.cmd, data, msg.id);
		}

		switch(msg.cmd) {
		case 'echo': 
			response(ws, 'echo', msg.data, msg.id);
			break;
		case 'makeroom':
		case 'joinroom':
		case 'randroom':
		case 'quitroom':
		case 'chat':
			getuser(function(user){
				redisclient.get('roomid:'+user, check(function(roomid){
					if (roomid) {	// room exists
						if (msg.cmd=='quitroom') {
							redisclient.llen('room:'+roomid, check(function(len){
								if (len<2) { // destroy the room if it's empty
									redisclient.multi()
									.del('room:'+roomid)
									.del('roomid:'+user)
									.exec(check(function(){
										send({room:null});
										delRoom(roomid);
									}));
								} else { // tell others that I left the room
									redisclient.multi()
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
						} else {
							responseErr(ws, msg.cmd, 'already_in_room_err', msg.id);
						}
					} else {	// room does not exist
						if (msg.cmd=='makeroom') {
							redisclient.incr('next_room_id', check2(function(newid){
								redisclient
								.multi()
								.set('roomid:'+user, newid)
								.lpush('room:'+newid, user)
								.exec(check(function(data){
									addRoomUser(newid, user);
									send({room:{roomid:newid, users:[user]}});
								}));
							}));
						} else if (msg.cmd=='joinroom') {
							try {
								var roomid = msg.data.roomid;
								var room = 'room:'+roomid;
								redisclient.exists(room, check2err('room_not_exist',function(data){
									redisclient.lpush(room, user, check(function(count){
										if (count > MAX_ROOM_SIZE) {	// room is full
											redisclient.ltrim(room, -MAX_ROOM_SIZE, -1);	// keep the first 4 users
											senderr('room_full_err');
										} else {
											redisclient.set('roomid:'+user, roomid, check(function(res){
												redisclient.lrange(room, 0, -1, check(function(users){
													addRoomUser(roomid, user);
													send({room:{users:users}});
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
				senderr('empty_nick');
			} else {
				getuser(function(user) {
					// name already exists?
					// DON'T use SISMEMBER + SADD: ismember和add之间其他玩家可以进行操作
					redisclient.sadd('nicknames', newname, check2err('nick_exist',function(){
						redisclient.get('account:'+user+':id', check2(function(userid){
							redisclient.hset('role:'+userid, 'nickname', newname, check(function(res){
								responseData(ws, 'rename', {role:{nickname:newname}}, msg.id);
							}));
						}));
					}));
				});
			}
			break;
		case 'view':
			getuser(function(user){
				redisclient.get('account:'+user+':id', check2(function(id){
					switch (msg.data.name) {
						case 'role':
							redisclient.hgetall('role:'+id, check(function(role){
								if (role) {
									response(ws, 'view', {role:role}, msg.id);
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
									redisclient.hmset('role:'+id, newRole, check(function(data){
										response(ws, 'view', {role:newRole}, msg.id);
									}));
								}
							}));
							break;
						case 'girl':
							redisclient.hgetall('girl:'+id+':'+msg.data.id, check2(function(girl){
								response(ws, 'girl', {girl:girl}, msg.id);
							}));
							break;
					}
				}));
			});
			break;
		case 'reg':
			var user = msg.data.user;
			var pass = msg.data.pass;
			if (!pass) {
				senderr('empty_pass_err');
			} else {
				redisclient.sadd('usernames', newname, check2err('user_exist',function(){
					redisclient.multi()
					.incr('next_account_id')
					.set('user:'+user, pass)
					.exec(check(function(res){
						redisclient.set('account:'+user+':id', res[0], check2(function(){
							response(ws, 'reg', '', msg.id);
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
			redisclient.get('user:'+user, check2err('user_not_exist', function(storedpass){
				if (pass != storedpass) {
					senderr('pass_err');
				} else {
					// session exist - multiple logins
					redisclient.get('session:'+user, check(function(oldsess){
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
								redisclient.getset('session:'+user, session, check(function(oldsession){
									redisclient.multi()
									.del('sessionuser:'+oldsession, session)
									.set('sessionuser:'+session, user)
									.exec(check(function(res){
										user2ws[user] = ws;
										ws2user[ws] = user;
										response(ws, 'login', {session:session}, msg.id);

										// in a room?
										redisclient.get('roomid:'+user, check(function(roomid){
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

//}	// end else cluster

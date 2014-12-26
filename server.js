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

roomsub.psubscribe('room.*');	//psubscribe -> pmessage
roomsub.on('pmessage', function(pattern, channel, message){
	var roomid = channel.split('.')[1];
	try {
		var msg = JSON.parse(message);
	} catch(e) {
		msg = {};
	}
	
	// find users in the room
	var users = room2user[roomid];
	if (!users) {
		switch (msg.cmd) {
		case 'sync':	// sync properties with other players
			var syncmsg = {};
			syncmsg.cmd = 'sync';
			syncmsg.data = msg.data;
			var syncstr = JSON.stringify(syncmsg);
			for(var i in users) {
				var ws = user2ws[users[i]];
				if (ws) {
					ws.send(syncstr);
				}
			}
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

function checkSession (session, cb) {
	if (session) {
		redisclient.get('sessionuser:'+session, function(err, user) {
			if (err || !user) {
				cb('session错误');
			} else {
				cb(null, user);
			}
		});
	} else {
		cb('session错误');
	}
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
//					redisclient.del('sessionuser:'+sess);
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
		switch(msg.cmd) {
		case 'echo': 
			response(ws, 'echo', msg.data, msg.id);
			break;
		case 'makeroom':
		case 'joinroom':
		case 'randroom':
		case 'quitroom':
		case 'chat':
			checkSession(msg.session, function(err, user){
				if (err) {
					responseErr(ws, msg.cmd, 'session_err', msg.id);
				} else {
					redisclient.get('roomid:'+user, function(err,roomid){
						if (err) {
							responseErr(ws, msg.cmd, 'db_err', msg.id);
						} else if (roomid) {	// room exists
							if (msg.cmd=='quitroom') {
							} else if (msg.cmd=='chat') {
							} else {
								responseErr(ws, msg.cmd, 'not_in_room_err', msg.id);
							}
						} else {	// room does not exist
							if (msg.cmd=='makeroom') {
								redisclient.incr('next_room_id', function(err, newid){
									if (err || !newid) {
										responseErr(ws, msg.cmd, 'db_err', msg.id);
									} else {
										redisclient
										.multi()
										.set('roomid:'+user, newid)
										.lpush('room:'+newid, user)
										.exec(function(err, data){
											if (err) {
												responseErr(ws, msg.cmd, 'db_err', msg.id);
											} else {
												responseData(ws, msg.cmd, {room:{roomid:newid, users:[user]}}, msg.id);
											}
										});
									}
								});
							} else if (msg.cmd=='joinroom') {
								try {
									var roomid = msg.data.roomid;
									redisclient.lpush('room:'+roomid, user, function(err,count){
										if (err) {
											responseErr(ws, msg.cmd, 'db_err', msg.id);
										} else {
											if (count > MAX_ROOM_SIZE) {	// room is full
												redisclient.ltrim('room:'+roomid, -MAX_ROOM_SIZE, -1);	// keep the first 4 users
												responseErr(ws, msg.cmd, 'room_full_err', msg.id);
											} else {
												redisclient.lrange('room:'+roomid, 0, -1, function(err,users){
													if (err) {
														responseErr(ws, msg.cmd, 'db_err', msg.id);
													} else {
														responseData(ws, msg.cmd, {room:{users:users}}, msg.id);
													}
												});
											}
										}
									});
								} catch (e) {
									responseErr(ws, msg.cmd, 'msg_err', msg.id);
								}
							} else if (msg.cmd=='randroom'){
								// get a random* room with available seats
							} else {
								responseErr(ws, msg.cmd, 'already_in_room_err', msg.id);
							}

						}
					});
				}
			});
			break;
		case 'rename':
			try {
				var newname = msg.data.nickname;
			} catch (e) {
				responseErr(ws, 'rename', '消息错误', msg.id);
			}
			if (!newname) {
				responseErr(ws, 'rename', '昵称不能为空', msg.id);
			} else {
				checkSession(msg.session, function(err,user) {
					if (err) {
						responseErr(ws, 'rename', err, msg.id);
					} else {
						// name already exists?
						// DON'T use SISMEMBER + SADD: ismember和add之间其他玩家可以进行操作
						redisclient.sadd('nicknames', newname, function(err,res){
							if (err) {
								responseErr(ws, 'rename', '数据错误', msg.id);
							} else if (!res) {
								responseErr(ws, 'rename', '昵称已存在', msg.id);
							} else {
								redisclient.get('account:'+user+':id', function(err, userid){
									if (!err && userid) {
										redisclient.hset('role:'+userid, 'nickname', newname, function(err, res){
											responseData(ws, 'rename', {role:{nickname:newname}}, msg.id);
										});
									} else {
										responseErr(ws, 'rename', '数据错误', msg.id);
									}
								});
							}
						});
					}
				});
			}
			break;
		case 'view':
			checkSession(msg.session, function(err,user){
				if (err) {
					responseErr(ws, 'view', err, msg.id);
				} else {
					redisclient.get('account:'+user+':id', function(err,id){
						if (!err && id) {
							//
							switch (msg.data.name) {
							case 'role':
								redisclient.hgetall('role:'+id, function(err,role){
									if (!err) {
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
											redisclient.hmset('role:'+id, newRole, function(err,data){
												response(ws, 'view', {role:newRole}, msg.id);
											});
										}
									} else {
										responseErr(ws, 'view', 'role数据错误', msg.id);
									}
								});
								break;
							case 'girl':
								redisclient.hgetall('girl:'+id+':'+msg.data.id, function(err,girl){
									if (!err && girl) {
										response(ws, 'girl', {girl:girl}, msg.id);
									} else {
										responseErr(ws, 'girl', 'girl数据错误', msg.id);
									}
								});
								break;
							}
						} else {
							console.log(user, 'no id');
							responseErr(ws, 'view', 'id错误', msg.id);
						}	
					});
				}
			});
			break;
		case 'reg':
			var user = msg.data.user;
			redisclient.exists('user:'+user, function(err,res){
				if (err) {
					responseErr(ws, 'reg', '数据错误', msg.id);
				} else if (res) {
					responseErr(ws, 'reg', '用户名已存在', msg.id);
				} else {
					var pass = msg.data.pass;
					if (!pass) {
						responseErr(ws, 'reg', '密码不能为空', msg.id);
					} else {
						// ok
						redisclient.set('user:'+user, pass, function(err,res){
							redisclient.incr('next_account_id', function(err,id){
								if (!err && id) {
									redisclient.set('account:'+user+':id', id);
									response(ws, 'reg', '', msg.id);
								}
							});
						});
					}
				}
			});
			break;
		case 'login':
			try {
				var user = msg.data.user;
				var pass = msg.data.pass;
			} catch (e) {
				console.log(e);
				responseErr(ws, 'login', '数据错误', msg.id);
				return;
			}
			
			// user/pass valid?
			redisclient.get('user:'+user, function(err,res){
				if (err) {
					responseErr(ws, 'login', '数据错误', msg.id);
				} else if (!res) {
					responseErr(ws, 'login', '用户不存在', msg.id);
				} else if (pass != res) {
					responseErr(ws, 'login', '密码错误', msg.id);
				} else {
					// session exist - multiple logins
					redisclient.get('session:'+user, function(err,oldsess){
						var ok = true;
						if (oldsess) {
							console.log('user exist');
							// kick the prev user
							var prevws = user2ws[user];
							if (prevws) {	// same machine
								if (prevws != ws) {
									// kick
									prevws.close(4001);
									removeWs(prevws);
								} else {
									responseErr(ws, 'login', '重复登录', msg.id);
									ok = false;
								}
							} else {
								userpub.publish('user', JSON.stringify({cmd:'kick', user:user, appid:appid}));
							}
						} 
						if (ok) {
							generateSession(function(session){
								// destroy previous sessionuser
								redisclient.getset('session:'+user, session, function(err, oldsession){
									redisclient.multi()
									.del('sessionuser:'+oldsession, session)
									.set('sessionuser:'+session, user)
									.exec(function(err,res){
										user2ws[user] = ws;
										ws2user[ws] = user;
										response(ws, 'login', {session:session}, msg.id);
									});
								
								});
							});	
						}
					});
				}
			});
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

}	// end else cluster

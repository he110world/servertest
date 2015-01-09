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
var adminsub = redis.createClient();
var db = redis.createClient();
var table = require('./table.json');
var Role = require('./role');
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

adminsub.subscribe('admin');
adminsub.on('message', function(channel, message){
	try {
		var msg = JSON.parse(message);
	} catch(e) {
		msg = {};
		console.log(e);
	}
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
	
});

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
		if (appid != msg.appid) {	// don't kick yourself!
			wss.kick(msg.user);
		}
		break;
	case 'notify':
		wss.notify(msg.user, msg.msgstr);
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
			var roomcast = function (cmd,data) {
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
			roomcast(msg.cmd, msg.data);
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

function notifymsg (user, msg) {
	var ws = user2ws[user];
	try {
		var msgstr = JSON.stringify(msg);
		if (ws) {	// same server : don't bother to PUB
			ws.send(msgstr);
		} else {	// different server : simply PUB
			publishData(userpub, 'user', {cmd:'notify', user:user, msgstr:msgstr});
		}
	} catch (e) {
		console.log(e);
	}
}

function kickmsg (user) {
	publishData(userpub, 'user', {cmd:'kick', user:user, appid:appid});
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
			//@cmd echo
			//@nosession
			//@desc 返回客户端发送的数据
			sendobj(msg.data);
			break;
		case 'makeroom':
			//@cmd makeroom
			//@desc 开房间
			getuser(function(user){
				db.exists('roomid:'+user, check(function(exist){
					if (exist) {
						senderr('already_in_room_err');
					} else {
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
					}	
				}));
			});
			break;
		case 'joinroom':
			//@cmd joinroom
			//@data roomid
			//@desc 加入现有房间
			getuser(function(user){
				db.exists('roomid:'+user, check(function(exist){
					if (exist) {
						senderr('already_in_room_err');
					} else {
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
					}
				}));
			});
			break;
		case 'randroom':
			//@cmd randroom
			//@desc 加入随机房间（TODO）
			senderr('not_implemented_err');
			break;
		case 'quitroom':
			//@cmd quitroom
			//@desc 退出当前房间
			getuser(function(user){
				db.get('roomid:'+user, check2(function(roomid){
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
				}));
			});
			break;
		case 'roomchat':
			//@cmd roomchat
			//@data msg
			//@desc 房间内聊天
			getuser(function(user){
				db.get('roomid:'+user, check2(function(roomid){
					roommsg(roomid, 'chat', {user:user, msg:msg.data.msg});
				}));
			});
			break;
		case 'roomsync':
			getuser(function(user){
				db.get('roomid:'+user, check2(function(roomid){
					roommsg(roomid, 'sync', {user:user, data:msg.data});
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
				
			getuser(function(user, userid){
				//we need Lv & RoleExp
				var query = ['Lv', 'RoleExp'];
				db.hmget('role:'+userid, query, check2(function(data){
					if (data.length < query.length) {
						senderr('db_err');
					} else {
						var role = new Role(table);
						console.log(data);
						role.Lv = data[0];
						role.RoleExp = data[1];
						try {
							var mod = role.addExp(expinc);
							db.hmset('role:'+userid, mod, check(function(){
								sendobj({role:mod});
							}));
						} catch (e) {
							senderr('role_err');
						}
					}
				}));
			});
			break;
		case 'ADD_PhotonSeed':
			//@cmd ADD_PhotonSeed
			//@data count
			//@desc 加光粒子结晶
		case 'ADD_Credit':
			//@cmd ADD_Credit
			//@data count
			//@desc 加游戏币
		case 'ADD_FriendCoin':
			//@cmd ADD_FriendCoin
			//@data count
			//@desc 加绊金币
		case 'ADD_OddCoin':
			//@cmd ADD_OddCoin
			//@data count
			//@desc 加欠片
			try {
				var money = msg.cmd.split('_')[1];
				getuser(function(user, userid){
					try {
						var count = msg.data.count;
					} catch(e) {
						count = 100;
					}
					db.hincrby('role:'+userid, money, count, check(function(newcount){
						var role = {};
						role[money] = newcount;
						sendobj({role:role});
					}));
				});
			} catch (e) {
				senderr('data_err:count');
			}
			break;
		case 'ADD_Item':
			//@cmd ADD_Item
			//@data id
			//@data count
			//@desc 加物品
			getuser(function(user, userid){
				try {
					var itemid = msg.data.id;
					var count = msg.data.count;
					db.hincrby('item:'+userid, itemid, count, check(function(){
						sendnil();
					}));
				} catch (e) {
					senderr('data_err:id,count');
				}
			});
			break;
		case 'requestfriend':
			//@cmd requestfriend
			//@data target
			//@desc 求加好友（target暂时为好友用户名）
			//
			// <user> -> pendingfriends:<target>
			// tell target
			getuser(function(user, userid){
				try {
					var target = msg.data.target;
					db.sadd('pendingfriends:'+target, user, check(function(){
						sendnil();
						var data = {};
						data.pendingfriends = {};
						data.pendingfriends[user] = 1;
						notifymsg(target, {cmd:"view", data:data});
					}));
				} catch (e) {
					senderr('data_err:target');
				}
			});
			break;
		case 'delfriend':
			//@cmd delfriend
			//@data target
			//@desc 删除好友
			//
			// friends:<user> -remove-> <target>
			// friends:<target> -remove-> <user>
			// tell self
			// tell target
			getuser(function(user, userid){
				try {
					var target = msg.data.target;
					db.srem('friends:'+user, target, check2(function(){
						db.srem('friends:'+target, user, check2(function(){
							var userdata = {};
							userdata.friends = {};
							userdata.friends[target] = null;
							sendobj(userdata);

							var targetdata = {};
							targetdata.friends = {};
							targetdata.friends[user] = null;
							notifymsg(target, {cmd:"view", data:targetdata});
						}));
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
			getuser(function(user, userid){
				try {
					var target = msg.data.target;
					db.srem('pendingfriends:'+user, target, check2(function(){
						db.sadd('friends:'+user, target, check(function(){
							db.sadd('friends:'+target, user, check(function(){
								var userdata = {};
								userdata.pendingfriends = {};
								userdata.pendingfriends[target] = null;
								userdata.friends = {};
								userdata.friends[target] = 1;
								sendobj(userdata);

								var targetdata = {};
								targetdata.friends = {};
								targetdata.friends[user] = 1;
								notifymsg(target, {cmd:"view", data:targetdata});
							}));
						}));
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
			getuser(function(user, userid){
				try {
					var target = msg.data.target;
					db.srem('pendingfriends:'+user, target, check2(function(){
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
		case 'buyitem':
			//@cmd buyitem
			//@data shopid
			//@data itemid
			//@desc 买物品
			getuser(function(user, userid){
				// cost
				try {
					var shopid = msg.data.shopid;
					var itemid = msg.data.itemid;
					var money = null;
					if (shopid == 1) {	//credit
						money = "Credit";
					} else if (shopid == 2) {	//photonseed
						money = "PhotonSeed";
					} else if (shopid == 3) {	//friendcoin
						money = "FriendCoin";
					} else if (shopid == 4) {	//oddcoin
						money = "OddCoin";
					} else {
						senderr('wrong_shop_err');
						return;
					}
					db.hget('role:'+userid, money, check(function(count){
						var cost = table.item[itemid][money];
						if (cost > count) {
							senderr('not_enough_'+money+'_err');
						} else {
							db.hincrby('role:'+userid, money, -cost, check(function(newmoney){
								db.hincrby('item:'+userid, itemid, 1, check(function(newcount){
									var obj = {};
									obj.role = {};
									obj.role[money] = newmoney;
									obj.item = {};
									obj.item[itemid] = newcount;
									sendobj(obj);
								}));
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
			//@desc 姬娘扭蛋（item格式为{id1:count，...，idN:count}）
			getuser(function(user, userid){
				// cost
				db.hget('role:'+userid, 'PhotonSeed', check(function(photon){
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
			//@cmd view
			//@data name
			//@data id
			//@desc 查看数据：role，girl，room，item，friends，pendingfriends（只有girl需要用到id）
			getuser(function(user, id){
				var viewname = msg.data.name;
				switch (viewname) {
					case 'role':
						db.hgetall('role:'+id, check2(function(role){
							if (role) {
								sendobj({role:role});
							} else {
								// create role
								var newRole = new Role();
								newRole.newRole();
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
					case 'friends':
					case 'pendingfriends':
						db.smembers(viewname+':'+user, check(function(friendset){
							// convert array to obj
							var friends = {};
							for (var i in friendset) {
								friends[friendset[i]] = 1;
							}
							var userdata = {};
							userdata[viewname] = friends;
							sendobj(userdata);
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
					.exec(check(function(res){
						var userid = res[0];
						db.set('account:'+user+':id', userid, check2(function(){
							// create role
							var newRole = new Role();
							newRole.newRole();
							db.hmset('role:'+userid, newRole, check(function(){
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
								kickmsg(user);
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

wss.notify = function (user, datastr) {
	var ws = user2ws[user];
	if (ws) {
		ws.send(datastr);
	}
}

process.on('SIGINT', function() {
	for(var i in wss.clients) {
		wss.clients[i].close(4002);
	}
	process.exit();
});
//}	// end else cluster

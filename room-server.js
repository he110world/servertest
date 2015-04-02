/*
   Rooms are stored in a sorted set			- roomqueue
   search requests are stored in a queue	- searchqueue
  
   "Room": {
	   "recruit": true/false,
	   "id": 999,
	   "mapid": 11000,
	   "lvmin": 1,
	   "lvmax": 999,
	   "time": 12345
   },
   "Search": {
	   "search": true/false,
	   "lv": 50,
	   "roomid": 999,
	   "mapid": 11000,
	   "id": 888,
	   "time": 23456
   }

   Relationships between room and search
   s -> R <- j -> A

   Search algorithm
   pop search queue, until not timeout
   if search s
     find first R, whose lvmin <= s.lv <= lvmax
   else if search j
     find R or A, whose roomid == j.roomid
   if search fails
     enqueue the search
	 */

var redis = require('redis');
var db = redis.createClient();
var pub = redis.createClient();
var Search = require('./search');
var Room = require('./room');
var TIME_OUT = 5000;
var cnt = 1;
function nextSearch () {
	if (cnt % 100 == 0) {
		console.log(cnt);
	}
	++cnt;

	// dequeue search queue
	getPlayer(function(player){

		// find suitable room
		findRoom(player, 0, function(room){

			// add to room
			enterRoom(player, room, function(){

				// tell room members
				searchSucceed(player, room, function(){

					// keep on searching
					nextSearch();
				});
			});
		});
	});
}

function searchSucceed (player, room, cb) {
	db.hdel('searchinfo', player.id, function(err){
		pub.publish('recruit.ok', room.id);
		cb();
	});
}

function searchFail (uid, err) {
	// delete failed searchinfo
	db.hdel('searchinfo', uid, function(e,d){
		// broardcast err
		pub.publish('recruit.err', uid+'$'+err);
	});
}

function getPlayer (cb) {
	var t1 = Date.now();
	db.multi().
	zrange('searchqueue', 0, 0).
	zremrangebyrank('searchqueue', 0, 0).
	exec(function(err, data){
		if (data && data.length==2 && data[0].length>0) {
			var uid = data[0][0];
			db.hget('searchinfo', uid, function(err,searchstr){
				if (searchstr) {
					var player = new Search(searchstr);
					if (Date.now() - player.time < TIME_OUT) {	
						cb(player);
						return;
					} 
				}
				searchFail(uid, 'timeout');	// found nothing / timeout
				nextSearch();
			});
		} else {
			// don't spin too fast
			var dt = Date.now() - t1;
			if (dt < 100) {
				setTimeout(nextSearch, 100 - dt);
			} else {
				nextSearch();
			}
		}
	});
}

function searchAgain (player) {
	db.zadd('searchqueue', Date.now(), player.id, nextSearch);
}

// check whether room is empty or full
function checkRoom (player, roomid, cb) {
	db.llen('room:'+roomid, function(err,len){
		if (len<1 || len>=4) {
			db.zrem('roomqueue', roomid, function(err,data){	// remove from roomqueue
				if (len < 1) {
					// empty room, delete room 
					db.multi()
					.del('room:'+roomid)
					.smove('roomused','roomfree', roomid)	// recycle room id
					.exec(function(err){
						cb(null);
					});
				} else {
					cb(null);
				}
			});
		} else {	// validation
			db.hget('roominfo', roomid, function(err,roomstr){
				if (roomstr !== null) {
					var room = new Room(roomstr);
					if (room.canAdd(player)) {
						cb(room);
					} else {
						cb(null);
					}
				} else {
					cb(null);
				}
			});
		}
	});
}

function checkRooms (player, roomids, cb) {
	// iterate through rooms one by one
	var roomid = roomids.shift();
	if (roomid) {
		checkRoom(player, roomid, function(room){
			if (room) {	// done
				cb(room);
			} else {
				checkRooms (player, roomids, cb);
			}
		});
	} else {
		cb(null);
	}
}

function findRoom (player, cursor, cb) {
	if (player.search) {	// search
		db.zscan('roomqueue', cursor, function(err, data){
			var next = data[0];
			var id_time = data[1];
			if (id_time.length > 0) {
				var roomids = id_time.filter(function(id,i){return i%2==0;});	// keep first (id), skip score(time)
				checkRooms(player, roomids, function(room){
					if (room) {
						cb(room);
					} else if (next != 0) {
						findRoom (player, next, cb);
					} else {// search finished & found nothing
						searchAgain (player);
					}
				});
			} else if (next != 0) {
				findRoom (player, next, cb);
			} else {	// search finished & found nothing
				searchAgain (player);
			}
		});
	} else {	// join
		checkRoom(player, player.roomid, function(room, len){
			if (room) {
				cb(room);
			} else {
				var err = len>=4 ? 'room_full' : 'room_invalid';
				searchFail(player.id, err);
				nextSearch();
			}
		});
	}
}

function enterRoom (player, room, cb) {
	var roomkey = 'room:'+room.id;
	db.lpush(roomkey, player.id, function(err,cnt){
		if (cnt > 4) {	// room full
			db.lrem(roomkey, 0, player.id, function(){
				if (player.search) {
					searchAgain (player);
				} else {
					searchFail(player.id, 'room_full');
					nextSearch();
				}
			});
		} else { // succeed 
			db.hset('role:'+player.id, 'Room', room.id, function(){
				cb();
			});
		}
	});
}

nextSearch();

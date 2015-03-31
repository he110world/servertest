var redis = require('redis');
var db = redis.createClient();
var pub = redis.createClient();
var Search = require('./search');
var TIME_OUT = 5000;

/*
   Rooms are stored in a sorted set			- roomrecruit
   search requests are stored in a queue	- roomsearch
  
   Room format
   R : roomid : mapid : lvmin : lvmax -> creation time
   A : roomid : mapid
   store room format in room data
   
   Search format
   s : lv     : mapid : uid : creation time
   j : roomid : mapid : uid : creation time

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
function nextSearch () {

	// dequeue search queue
	getPlayer(function(player){

		// find suitable room
		findRoom(player, 0, function(room){

			// add to room
			enterRoom(player, room, function(){

				// tell room members
				notifyRoom(room.roomid);

				// keep on searching
				nextSearch();
			});
		});
	});
}

function notifyRoom (roomid) {
	pub.publish('recruit.ok', roomid);
}

function notifyError (uid, err) {
	pub.publish('recruit.err', uid+'$'+err);
}

function getPlayer (cb) {
	var t1 = Date.now();
	db.rpop('roomsearch', function(err, data){
		if (data !== null) {
			var player = new Search.Player(data);
			if (Date.now() - player.time < TIME_OUT) {	
				cb(player);
			} else {	// search timeout
				notifyError(player.uid, 'timeout');
				nextSearch();
			}
		} else {
			// don't spin too fast
			var dt = Date.now() - t1;
			if (dt < 10) {
				setTimeout(nextSearch, 10 - dt);
			} else {
				nextSearch();
			}
		}
	});
}

function searchAgain (player) {
	db.lpush('roomsearch', player.str, nextSearch);
}

function findRoom (player, cursor, cb) {
	if (player.isSearch) {	// search
		db.zscan('roomrecruit', cursor, function(err, data){
			var next = data[0];
			var rooms = data[1];
			if (rooms.length > 0) {
				for (var i=0; i<rooms.length; i+=2) {
					var room = new Search.Room(rooms[i]);
					if (room.canAdd(player)) {
						cb(room);
						return;
					}
				}
				if (next != 0) {
					findRoom (player, next, cb);
				} else {	// search finished & found nothing
					searchAgain (player);
				}
			} else if (next != 0) {
				findRoom (player, next, cb);
			} else {	// search finished & found nothing
				searchAgain (player);
			}
		});
	} else {	// join
		joinRoom(player);
	}
}

function enterRoom (player, room, cb) {
	var roomkey = 'room:'+room.roomid;
	db.llen(roomkey, function(err, len){
		if (len < 4) {
			db.lpush(roomkey, player.uid, function(err,data){
				cb();
			});
		} else {	// room full
			searchAgain (player);
		}
	});
}

function joinRoom (player) {
	var roomkey = 'room:'+player.roomid;
	db.llen(roomkey, function(err, len){
		if (len < 1 || len>=4) {	// invalid room || full
			var err = len>=4 ? 'full' : 'invalid';
			notifyError(player.uid, err);
			nextSearch();
		} else {	// bingo
			db.lpush(roomkey, player.uid, function(err,data){
				notifyRoom(player.roomid);
				nextSearch();
			});
		}
	});
}

nextSearch();

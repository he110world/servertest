function Search () {
}

Search.prototype.Player = function (data) {
	this.str = data;
	var p = data.split(':');
	this.isSearch = p[0] === 's';
	if (this.isSearch) {	// search
		this.lv = p[1];
	} else {	// join
		this.roomid = p[1];
	}
	this.mapid = p[2];
	this.uid = p[3];
	this.time = p[4];
}

Search.prototype.Room = function (data) {
	this.str = data;
	var r = data.split(':');
	this.isRecruit = r[0] === 'R';
	this.roomid = r[1];
	this.mapid = r[2]
	if (this.isRecruit) {	// recruit
		this.lvmin = r[3];
		this.lvmax = r[4];
	}
}

Search.prototype.Room.prototype.canAdd = function (p) {
	if (p.isSearch) {
		return this.isRecruit 
			&& p.mapid==this.mapid 
			&& p.lv>=this.lvmin 
			&& p.lv<=this.lvmax;
	} else {
		return p.roomid == this.roomid;
	}
}

module.exports = new Search;

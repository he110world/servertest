function Room (obj) {
	if (typeof obj === 'string') {
		obj = JSON.parse(obj);
	}
	if (typeof obj === 'object') {
		this.id = obj.id;
		this.mapid = obj.mapid;
		if (obj.recruit) {
			this.recruit = true;
		}
		if (obj.lvmin) {
			this.lvmin = obj.lvmin;
		}
		if (obj.lvmax) {
			this.lvmax = obj.lvmax;
		}
		if (obj.time) {
			this.time = obj.time;
		} else {
			this.time = Date.now();
		}
	}
}

// canAdd(player)
Room.prototype.canAdd = function (p) {
	if (p.search) {
		return this.recruit 
			&& this.mapid==p.mapid 
			&& this.lvmax>=p.lv
			&& this.lvmin<=p.lv;
	} else {	// join
		return this.id == p.roomid
			&& this.mapid == p.mapid;
	}
}

module.exports = Room;

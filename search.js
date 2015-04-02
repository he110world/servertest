function Search (obj) {
	if (typeof obj === 'string') {
		obj = JSON.parse(obj);
	}
	if (typeof obj === 'object') {
		if (obj.search) {
			this.search = true;
		}
		if (obj.lv) {
			this.lv = obj.lv;
		}
		if (obj.roomid) {
			this.roomid = obj.roomid;
		} else {
			this.search = true;
		}
		if (obj.mapid) {
			this.mapid = obj.mapid;
		}
		if (obj.id) {
			this.id = obj.id;
		}
		if (obj.time) {
			this.time = obj.time;
		} else {
			this.time = Date.now();
		}
	}
}

module.exports = Search;

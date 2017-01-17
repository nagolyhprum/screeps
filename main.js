const mapCreeps = key => Game.creeps[key];

const filterIsWorker = creep => creep.memory.type === "worker";

const sortCS = (a, b) => (b.progress + b.progressTotal) - (a.progress + a.progressTotal)

const mapCS = key => Game.constructionSites[key];

const reduceStorage = (storage, structure) => structure.structureType === STRUCTURE_TOWER ? [structure, ...storage] : [...storage, structure]

const filterStorage = {
    filter : structure => [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER].includes(structure.structureType) && structure.energy < structure.energyCapacity
};

const filterTowers = {
    filter : structure => structure.structureType === STRUCTURE_TOWER
};

var danger = "";

const filterIsNotWall = terrain => terrain.terrain !== "wall";

Memory.id = Memory.id || 1;

Memory.sources = Memory.sources || {};

module.exports.loop = function () {
    
    for(var i in Memory.creeps) {
        if(!Game.creeps[i]) {
            delete Memory.creeps[i];
        }
    }
    
    const rooms = Object.keys(Game.rooms).map(key => Game.rooms[key]);
    
    const controllers = rooms.map(room => room.controller).filter(controller => controller && controller.my);

    initSources(rooms);
    
    controllers.forEach(controller => {
        const { room } = controller;
        const spawn = room.find(FIND_STRUCTURES, {
            filter : structure => structure.structureType === STRUCTURE_SPAWN
        })[0] || Game.spawns[Object.keys(Game.spawns)[0]];
    
        const hurt = room.find(FIND_MY_CREEPS, {
           filter : creep => creep.hits < creep.hitsMax
        });
        
        const creeps = Object.keys(Game.creeps).map(mapCreeps).filter(creep => creep.memory.home === controller.id || !creep.memory.home); //TODO : REMOVE
        const workers = creeps.filter(filterIsWorker);
        
        const exits = Game.map.describeExits(room.name);
        const myRooms = [...Object.keys(exits).map(key => exits[key]), room.name];
        
        var mySources = myRooms.reduce((mySources, room) => {
            var sources = Memory.sources[room] || [];
            return [...mySources, ...Object.keys(sources).map(key => sources[key])];
        }, []);
        
        const count = Math.round(mySources.reduce((sum, source) => source.count + sum, 0) * 1.25);
        console.log(workers.length, count);
        const cs = Object.keys(Game.constructionSites).map(mapCS).sort(sortCS);
        if(workers.length < count) {
            const base = [WORK, CARRY, MOVE, MOVE];
            var body = base;
            var cost = 250;
            while((cost += 250) <= room.energyCapacityAvailable && workers.length >= count / 2 && cost <= 250 * 3) {
                body = [...body, ...base];
            }
            var result = spawn.createCreep(body.slice(0, 50), undefined, {
                id : Memory.id,
                type : "worker",
                home : controller.id
            });
            if(_.isString(result)) {
                Memory.id++;
            }
        }
        if(workers.length >= count) {
            var base = [TOUGH, TOUGH, MOVE, MOVE, MOVE, MOVE, ATTACK, RANGED_ATTACK];
            var body = [TOUGH, TOUGH, MOVE, MOVE, MOVE, ATTACK];
            var cost = 250;
            while((cost += 450) <= room.energyCapacityAvailable) {
                body = [...body.slice(0, 50), ...base];
            }
            spawn.createCreep(body, undefined, {
                type : "fighter",
                home : controller.id
            });
        }
        const hasExpander = !!creeps.find(creep => creep.memory.type === "expander");
        const unknown = myRooms.find(room => !Memory.sources[room]);
        if(workers.length >= count && !hasExpander) {
            if(unknown) {
                spawn.createCreep([MOVE], undefined, { 
                    type : "expander",
                    home : controller.id
                });
            }
        }
        const claimers = creeps.filter(creep => creep.memory.type === "claimer");
        if(workers.length >= count && claimers.length < myRooms.length - 1 && false) { //TODO
            const body = [MOVE, CLAIM];
            const cost = 650;
            while((cost += 650) <= room.energyCapacityAvailable && coust <= 1950) {
                body.push(MOVE);
                body.push(CLAIM);
            }
            spawn.createCreep(body, undefined, {
                type : "claimer",
                home : controller.id
            });
        }
        const damaged = room.find(FIND_STRUCTURES, {
            filter : structure => structure.hits < Math.min(structure.hitsMax, 1000)
        });
        const storage = room.find(FIND_STRUCTURES, filterStorage).reduce(reduceStorage, []);
        const hostiles = myRooms.map(key => Game.rooms[key]).filter(_ => _).reduce((hostiles, room) => [...room.find(FIND_HOSTILE_STRUCTURES), ...hostiles, ...room.find(FIND_HOSTILE_CREEPS)], []);
        
        danger = hostiles.length ? hostiles[0].room.name : danger;
        
        creeps.forEach(creep => {
            switch(creep.memory.type) {
                case "expander" :
                    if(!creep.memory.goal || Memory.sources[creep.memory.goal]) {
                        if(unknown) {
                            creep.memory.goal = unknown;
                        } else {
                            creep.suicide();
                        }
                    }
                    goToRoom(creep, creep.memory.goal);
                    break;
                case "worker" :
                    if(creep.carry.energy === creep.carryCapacity && creep.memory.isWorking) { 
                        creep.memory.isWorking = false;
                        var source = mySources.find(source => source.id === creep.memory.source);
                        source.list = source.list.filter(name => name !== creep.name);
                        creep.memory.source = "";
                    } else if(creep.carry.energy === 0 && !creep.memory.isWorking) {
                        creep.memory.isWorking = true;
                    }
                    if(creep.memory.isWorking) {
                        var source;
                        if(!creep.memory.source) {
                            source = mySources.find(source => source.list.length < source.count);
                            if(!source) return;
                            source.list.push(creep.name);
                        } else {
                            source = mySources.find(source => source.id === creep.memory.source);
                            if(!source) return;
                        } 
                        creep.memory.source = source.id;
                        //creep.say(Memory.sources[creep.room.name][creep.memory.source].list.length);
                        if(!goToRoom(creep, source.room)) {
                            source = Game.getObjectById(creep.memory.source);
                            if(creep.harvest(source) === ERR_NOT_IN_RANGE) {
                                creep.moveTo(source);
                            }
                        }
                    } else {
                        switch(creep.memory.id % 2) {
                            case 0 :
                                var store = target(creep, storage);
                                if(creep.transfer(store, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                                    creep.moveTo(store);
                                }
                                break;
                            case 1 :
                                if(creep.memory.id % 4 === 3 && damaged.length) {
                                    var d = target(creep, damaged);
                                    if(creep.repair(d) === ERR_NOT_IN_RANGE) {
                                        creep.moveTo(d);
                                    }
                                } else if(creep.memory.id % 4 === 3 && cs.length) {
                                    var c = target(creep, cs);
                                    if(creep.build(c) === ERR_NOT_IN_RANGE) {
                                        creep.moveTo(c);
                                    }
                                } else if(creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                                    creep.moveTo(controller);
                                }
                                break;
                        }   
                    }
                    break;
                case "fighter" :
                    if(hostiles.length) {
                        const hostile = creep.pos.findClosestByPath(hostiles);
                        if(creep.attack(hostile) === ERR_NOT_IN_RANGE | creep.rangedAttack(hostile) === ERR_NOT_IN_RANGE) {
                            creep.moveTo(hostile);
                        }
                    } else if(!goToRoom(creep, danger)) {
                        creep.moveTo(15, 40);
                    }
            }
        });
        room.find(FIND_MY_STRUCTURES, filterTowers).forEach(tower => {
            if(hostiles.length) {
                tower.attack(hostiles[0]);
            } else {
                tower.heal(hurt[0]);
            }
        });
        addSites(room);
    });
};

function addSite(room, site) {
    var cs = room.find(FIND_MY_CONSTRUCTION_SITES);
    if(cs.length < MAX_CONSTRUCTION_SITES) {
        var max = CONTROLLER_STRUCTURES[site][room.controller ? room.controller.level : 0];
        var built = room.find(FIND_MY_STRUCTURES, {
            filter : structure => structure.structureType === site 
        }).length;
        var toBuild = room.find(FIND_MY_CONSTRUCTION_SITES, {
            filter : cs => cs.structureType === site
        }).length;
        if(built + toBuild < max) {
            squareFrom(25, 25, (x, y) => {
                var terrain = room.lookForAtArea(LOOK_TERRAIN, y - 1, x - 1, y + 1, x + 1, true);
                var hasWall = terrain.reduce((hasWall, terrain) => hasWall || terrain.terrain === "wall", false);
                var goodSpot = (x + y) % 2 === 1 && !hasWall;
                var result = goodSpot ? room.createConstructionSite(x, y, site) : false;
                return x === 0 || result === OK;
            });   
        }
    }
}

function target(creep, targets) {
    var target = targets.find(target => target.id === creep.memory.target) || targets.shift();
    target && (creep.memory.target = target.id);
    return target;
}

function addSites(room) {
    if(room.controller && room.controller.my) {
        addSite(room, STRUCTURE_SPAWN);
        addSite(room, STRUCTURE_TOWER);
        addSite(room, STRUCTURE_EXTENSION);
    }
}

function goToRoom(creep, room) {
    var exits = Game.map.findRoute(creep.room.name, room);
    if(exits.length) {
        var exit = creep.pos.findClosestByPath(exits[0].exit);
        if(exit) {
            moveTo(creep, exit, {
                maxRooms : 1
            }); 
            return true;
        }  
    }
}

function moveTo(creep) {
    var args = Array.prototype.slice.call(arguments, 1);
    var path = creep.pos.findPathTo.apply(creep.pos, args);
    creep.moveByPath(path);
}

function squareFrom(x, y, callback) {
    var range = 1;
    while(true) {
        var range2 = 2 * range;
        for(var i = 0; i < range2; i++) { //top left to right
            if(callback(x - range + i, y - range) || callback(x - range, y - range + i) || callback(x + range, y - range + i) || callback(x - range + i, y + range)) {
                return;
            }
        }
        range++;  
    } 
}

function initSources(rooms) {
    const sources = rooms.reduce((sources, room) => [...sources, ...room.find(FIND_SOURCES)], []);
    sources.forEach(source => {
        var room = Memory.sources[source.room.name] = Memory.sources[source.room.name] || {};
        if(!room[source.id]) { 
            var { x, y } = source.pos;
            const count = source.room.lookForAtArea(LOOK_TERRAIN, y - 1, x - 1, y + 1, x + 1, true).filter(filterIsNotWall).length;
            room[source.id] = { count, list : [], room : source.room.name, id : source.id };
        }
        room[source.id].list = room[source.id].list.filter(name => Game.creeps[name]);
    });
}
const mapCreeps = key => Game.creeps[key]; 

const filterIsWorker = creep => creep.memory.type === "worker";
 
const sortCS = (a, b) => (b.progress + b.progressTotal) - (a.progress + a.progressTotal)

const filterStorage = {
    filter : structure => [STRUCTURE_LAB, STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER].includes(structure.structureType) && structure.energy < structure.energyCapacity
};

const filterTowers = {
    filter : structure => structure.structureType === STRUCTURE_TOWER
};

const filterIsNotWall = terrain => terrain.terrain !== "wall";

Memory.lairs = Memory.lairs || {};

Memory.id = Memory.id || {};

Memory.reserves = Memory.reserves || {};

Memory.sources = Memory.sources || {};

Memory.danger = Memory.danger || {};

const getClosestSpawn = roomName => Object.keys(Game.spawns).map(key => Game.spawns[key]).sort((a, b) => 
    Game.map.getRoomLinearDistance(roomName, a.room.name) - Game.map.getRoomLinearDistance(roomName, b.room.name)
)[0];

module.exports.loop = function () {
    
    for(var i in Memory.creeps) {
        if(!Game.creeps[i]) {
            delete Memory.creeps[i];
        }
    }
    
    const rooms = Object.keys(Game.rooms).map(key => Game.rooms[key]);
    
    rooms.forEach(room => {
        Memory.lairs[room.name] = !room.controller;
    })
    
    const controllers = rooms.map(room => room.controller).filter(controller => controller && controller.my).sort((a, b) => a.room.energyCapacityAvailable - b.room.energyCapacityAvailable);

    initSources(rooms);
    
    Object.keys(Memory.sources).forEach(room => {
        Object.keys(Memory.sources[room]).forEach(source => {
            Memory.sources[room][source].list = Memory.sources[room][source].list.filter(name => Game.creeps[name] && Game.creeps[name].memory.source === source)
        });
    });
    
    controllers.forEach(controller => {
        const { room } = controller;
        const spawns = room.find(FIND_STRUCTURES, {
            filter : structure => structure.structureType === STRUCTURE_SPAWN
        }).sort((a, b) => a.spawning ? 1 : -1);
        const spawn = spawns[0] || getClosestSpawn(room.name);
    
        const hurt = room.find(FIND_MY_CREEPS, {
           filter : creep => creep.hits < creep.hitsMax
        });
        
        const creeps = Object.keys(Game.creeps).map(mapCreeps).filter(creep => creep.memory.home === controller.id).sort((a, b) => a.memory.id - b.memory.id);
        const workers = creeps.filter(filterIsWorker);
        
        var myRooms = [room.name];
        
        for(var i = 0; i < myRooms.length; i++) {
            const roomName = myRooms[i];
            if(Game.rooms[roomName] && Game.rooms[roomName].controller && (Game.rooms[roomName].controller.level || (Game.rooms[roomName].controller.reservation && Game.rooms[roomName].controller.reservation.ticksToEnd >= 4000))) {
                const exits = Game.map.describeExits(roomName);
                myRooms = myRooms.concat(Object.keys(exits).map(key => exits[key]).filter(roomName => myRooms.indexOf(roomName) === -1 && !Memory.lairs[roomName]));
            }
        }
         
        var mySources = myRooms.reduce((mySources, room) => {
            var sources = room !== Memory.danger[controller.id] ?  Memory.sources[room] || [] : [];
            return [...mySources, ...Object.keys(sources).filter(key => Game.getObjectById(key) && (Game.getObjectById(key).energy || Game.getObjectById(key).mineralAmount)).map(key => sources[key])];
        }, []);
        
        const sourceCount = mySources.reduce((sum, source) => source.count + sum, 0);
        const workCount = Math.min(12, Math.floor(room.energyCapacityAvailable / 250));
        const count = sourceCount / workCount * 12;
        console.log("workers have", workers.length, "workers need", count, "parts", workCount, "rooms", myRooms.length, "spawns", spawns.length);
        const cs = Object.keys(Game.constructionSites).map(key => Game.constructionSites[key]).filter(cs => myRooms.includes(cs.pos.roomName) && cs.pos.roomName !== Memory.danger[controller.id]).sort(sortCS); 
        if(workers.length < count) {
            const base = [WORK, CARRY, MOVE, MOVE];
            var body = base;
            var cost = 250;
            while((cost += 250) <= workCount * 250 && workers.length >= count / 2) {
                body = [...body, ...base];
            }
            var result = spawn.createCreep(body, Date().toString(), {
                id : Memory.id[controller.id] || 0,
                type : "worker",
                home : controller.id
            });
            if(_.isString(result)) {
                Memory.id[controller.id] = (Memory.id[controller.id] || 0) + 1;
            }
        }
        const fighterCount = myRooms.length;
        const fighters = creeps.filter(creep => creep.memory.type == "fighter");
        if(workers.length >= count && fighters.length < fighterCount) {
            var base = [MOVE, RANGED_ATTACK, MOVE, HEAL]; //500
            var body = [TOUGH, TOUGH, MOVE, MOVE, MOVE, ATTACK];
            var cost = 250;
            if((cost += 500) <= room.energyCapacityAvailable && fighters.length >= fighterCount / 2) {
                body = [...body.slice(0, 50), ...base];
            }
            spawn.createCreep(body.sort((a, b) => BODYPART_COST[a] - BODYPART_COST[b]).slice(0, 50), Date().toString(), {
                type : "fighter",
                home : controller.id
            });
        }
        const hasExpander = !!creeps.find(creep => creep.memory.type === "expander");
        const unknown = myRooms.find(room => !Memory.sources[room]);
        if(workers.length >= count && !hasExpander) {
            if(unknown) {
                spawn.createCreep([MOVE], Date().toString(), { 
                    type : "expander",
                    home : controller.id
                });
            }
        }
        const reservers = creeps.filter(creep => creep.memory.type === "reserver");
        if(fighters.length >= fighterCount && reservers.length < myRooms.length - 1) { //TODO
            const body = [MOVE, MOVE, CLAIM, CLAIM];
            spawn.createCreep(body, Date().toString(), {
                type : "reserver",
                home : controller.id
            });
        }
        const damaged = myRooms.map(key => Game.rooms[key]).filter(_ => _).reduce((damaged, room) => [...damaged, ...room.find(FIND_STRUCTURES, {
            filter : structure => structure.hits < structure.hitsMax
        })], []);
        const storage = room.find(FIND_STRUCTURES, filterStorage); 
        const hostiles = myRooms.map(key => Game.rooms[key]).filter(_ => _).reduce((hostiles, room) => [...room.find(FIND_HOSTILE_CREEPS), ...hostiles], []);
         
        if(Memory.danger[controller.id]) { //if a room is in danger
            if(Game.rooms[Memory.danger[controller.id]]) { //and i am in that room
                if(!hostiles.reduce((isHere, hostile) => isHere || hostile.room.name === Memory.danger[controller.id], false)) { //and there are no more hostiles in that room
                    Memory.danger[controller.id] = "";
                }
            }
        } else if(hostiles.length) {
            Memory.danger[controller.id] = hostiles[0].room.name;
        }
        
        myRooms.forEach(room => {
            const isClaimed = Game.creeps[Memory.reserves[room]];
            const canClaim = !Game.rooms[room] || (Game.rooms[room].controller && !Game.rooms[room].controller.level);
            const creep = reservers.find(creep => !creep.memory.target);
            if(!isClaimed && creep && canClaim) {
                creep.memory.target = room;
                Memory.reserves[room] = creep.name;
            }
        });
        
        creeps.forEach(creep => {
            switch(creep.memory.type) {
                case "reserver" :
                    if(!goToRoom(creep, creep.memory.target)) {
                        const controller = creep.room.controller;
                        if(creep.reserveController(controller) == ERR_NOT_IN_RANGE) {
                            moveTo(creep, controller, {
                                maxRooms : 1
                            });
                        }
                    }
                    break;
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
                    if(_.sum(creep.carry) === creep.carryCapacity && creep.memory.isWorking) { 
                        creep.memory.isWorking = false;
                        var source = mySources.find(source => source.id === creep.memory.source);
                        if(!source) {
                            break;
                        }
                        creep.memory.source = "";
                    } else if(_.sum(creep.carry) === 0 && !creep.memory.isWorking) {
                        creep.memory.isWorking = true;
                    }
                    if(creep.memory.isWorking) {
                        var source;
                        if(!creep.memory.source) {
                            source = mySources.find(source => source.list.length < source.count);
                            if(!source) {
                                break;
                            }
                            source.list.push(creep.name);
                        } else {
                            source = mySources.find(source => source.id === creep.memory.source);
                            if(!source) {
                                creep.memory.source = "";
                                break;
                            }
                        } 
                        creep.memory.source = source.id;
                        if(!goToRoom(creep, source.room)) {
                            source = Game.getObjectById(creep.memory.source);
                            if(creep.harvest(source) === ERR_NOT_IN_RANGE) {
                                moveTo(creep, source, {
                                    maxRooms : 1
                                });
                            }
                        }
                    } else {
                        
                        if(!creep.carry[RESOURCE_ENERGY]) {
                            const lab = room.find(FIND_STRUCTURES, { filter : s => s.structureType === STRUCTURE_STORAGE})[0] || room.find(FIND_STRUCTURES, { filter : s => s.structureType === STRUCTURE_LAB && s.mineralAmount < s.mineralCapacity})[0]; //todo remove
                            const resource = Object.keys(creep.carry).find(resource => creep.carry[resource]);
                            if(lab && creep.transfer(lab, resource) === ERR_NOT_IN_RANGE) {
                                moveTo(creep, lab);
                            }
                            break;
                        }
                        
                        switch(storage.length ? creep.memory.id % 4 : 0) {
                            case 0 :
                                if(damaged.length && controller.ticksToDowngrade >= 1000) {
                                    var d = target(creep, damaged);
                                    if(creep.repair(d) === ERR_NOT_IN_RANGE) {
                                        moveTo(creep, d);
                                    }
                                } else if(cs.length && controller.ticksToDowngrade >= 1000) {
                                    var c = target(creep, cs.slice(0));
                                    if(creep.build(c) === ERR_NOT_IN_RANGE) {
                                        moveTo(creep, c);
                                    }
                                } else if(creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                                    moveTo(creep, controller);
                                }
                                break;
                            default :
                                if(!goToRoom(creep, room)) {
                                    var store = creep.pos.findClosestByPath(storage);
                                    var io = storage.indexOf(store);
                                    if(io) {
                                        storage.splice(io, 1);
                                    }
                                    if(creep.transfer(store, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                                        moveTo(creep, store);
                                    }   
                                }
                                break;
                        }   
                    }
                    break;
                case "fighter" :
                    if(Memory.danger[controller.id]) {
                        if(!goToRoom(creep, Memory.danger[controller.id])) {
                            const hostile = creep.pos.findClosestByPath(hostiles);
                            if(creep.attack(hostile) + creep.rangedAttack(hostile)) {
                                creep.heal(creep);
                                moveTo(creep, hostile, {
                                    maxRooms : 1
                                });
                            }
                        }
                    } else {
                        creep.heal(creep);
                        creep.moveTo(7, 40);
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
    
    const claimer = Object.keys(Game.creeps).map(key => Game.creeps[key]).find(creep => creep.memory.type === "claimer");
    if(!claimer && Game.flags.claim) {
        getClosestSpawn(Game.flags.claim.pos.roomName).createCreep([MOVE, CLAIM], Date().toString(), { //650
            type : "claimer"
        });
    }
    if(claimer) {
        if(!claimer.memory.target) {
            claimer.memory.target = Game.flags.claim;
        }
        if(!claimer.memory.target) {
            claimer.suicide();
        } else {
            const flag = Game.flags.claim;
            if(!goToRoom(claimer, flag.pos.roomName)) {
                const controller = claimer.room.controller;
                switch(claimer.claimController(controller)) {
                    case ERR_NOT_IN_RANGE :
                        moveTo(claimer, controller);
                        break;
                    case OK :
                        flag.remove();
                        claimer.memory.target = "";
                }
            }   
        }
    }
    console.log("---------------");
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
    var target = targets.find(target => target.id === creep.memory.target) || targets[0];
    const io = targets.indexOf(target);
    if(io >= 0) {
        targets.splice(io, 1);
    }
    target && (creep.memory.target = target.id);
    return target;
}

function addSites(room) {
    if(room.controller && room.controller.my) {
        addSite(room, STRUCTURE_SPAWN);
        addSite(room, STRUCTURE_TOWER);
        addSite(room, STRUCTURE_EXTENSION);
        addSite(room, STRUCTURE_STORAGE);
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
    try {
        var args = Array.prototype.slice.call(arguments, 1);
        var path = creep.pos.findPathTo.apply(creep.pos, args);
        creep.moveByPath(path); 
    } catch(e) {
    }
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
    const sources = rooms.reduce((sources, room) => [...sources, ...room.find(FIND_SOURCES), ...(room.find(FIND_STRUCTURES, { 
        filter : s => s.structureType === STRUCTURE_EXTRACTOR
    }).length ? room.find(FIND_MINERALS) : [])], []);
    rooms.forEach(room => Memory.sources[room.name] = Memory.sources[room.name] || {});
    sources.forEach(source => {
        var room = Memory.sources[source.room.name];
        if(!room[source.id]) { 
            var { x, y } = source.pos;
            const count = source.mineralType ? 1 : source.room.lookForAtArea(LOOK_TERRAIN, y - 1, x - 1, y + 1, x + 1, true).filter(filterIsNotWall).length;
            room[source.id] = { count, list : [], room : source.room.name, id : source.id };
        }
        room[source.id].list = room[source.id].list.filter(name => Game.creeps[name]);
    });
}
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

Memory.invaders = Memory.invaders || 0;

Memory.exits = Memory.exits || {};

Memory.owned = Memory.owned || {};

Memory.lairs = Memory.lairs || {};

Memory.id = Memory.id || {};

Memory.reserves = Memory.reserves || {};

Memory.sources = Memory.sources || {};

Memory.danger = Memory.danger || {};

const getClosestSpawn = roomName => Object.keys(Game.spawns).map(key => Game.spawns[key]).sort((a, b) => {
    const val = Game.map.getRoomLinearDistance(roomName, a.room.name) - Game.map.getRoomLinearDistance(roomName, b.room.name);
    return val ? val : (a.spawning ? 1 : -1);
})[0];

module.exports.loop = function () {
    
    for(var i in Memory.creeps) {
        if(!Game.creeps[i]) {
            delete Memory.creeps[i];
        }
    }
    
    const rooms = Object.keys(Game.rooms).map(key => Game.rooms[key]);
    
    rooms.forEach(room => {
        Memory.lairs[room.name] = !room.controller;
        if(!Memory.exits[room.name]) {
            const exits = Game.map.describeExits(room.name);
            Memory.exits[room.name] = Object.keys(exits).map(key => exits[key]);
        }
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
        
        const flags = room.find(FIND_FLAGS);
        
        const spawns = room.find(FIND_STRUCTURES, {
            filter : structure => structure.structureType === STRUCTURE_SPAWN
        }).sort((a, b) => a.spawning ? 1 : -1);
        const spawn = spawns[0] || getClosestSpawn(room.name);
    
        const hurt = room.find(FIND_MY_CREEPS, {
           filter : creep => creep.hits < creep.hitsMax
        });
        
        const creeps = Object.keys(Game.creeps).map(mapCreeps).filter(creep => creep.memory.home === controller.id).sort((a, b) => b.memory.id - a.memory.id);
        const workers = creeps.filter(filterIsWorker);
        
        var myRooms = [room.name];
        const MAX_ROOMS = 5;
        
        for(var i = 0; i < myRooms.length; i++) {
            const roomName = myRooms[i];
            if(myRooms.length < MAX_ROOMS && Memory.exits[roomName]) {
                myRooms = myRooms.concat(Memory.exits[roomName].filter(roomName => myRooms.indexOf(roomName) === -1 && !Memory.lairs[roomName] && (!Memory.owned[roomName] || Memory.owned[roomName] === controller.id)));
            }
        }
         
        myRooms = myRooms.slice(0, MAX_ROOMS);
        
        myRooms.forEach(roomName => Memory.owned[roomName] = controller.id);
        
        const dropped = myRooms.reduce((dropped, roomName) => [...dropped, ...(Game.rooms[roomName] ? Game.rooms[roomName].find(FIND_DROPPED_RESOURCES) : [])], [])
         
        var mySources = myRooms.reduce((mySources, room) => {
            var sources = room !== Memory.danger[controller.id] ?  Memory.sources[room] || [] : [];
            return [...mySources, ...Object.keys(sources).filter(key => !Game.getObjectById(key) || Game.getObjectById(key).energy || Game.getObjectById(key).mineralAmount).map(key => sources[key])];
        }, []);
        const extCost = BODYPART_COST[WORK] + BODYPART_COST[MOVE] * 2 + BODYPART_COST[CARRY] * 3;
        const workCount = Math.min(9, Math.floor((room.energyCapacityAvailable - BODYPART_COST[WORK] + BODYPART_COST[MOVE] + BODYPART_COST[CARRY]) / extCost) + 1);
        
        const timetomake = (3 + (workCount - 1) * 6) * CREEP_SPAWN_TIME / Math.max(spawns.length, 1);
        
        const count = Math.ceil(750 / timetomake);
        
        console.log(controller.room.name, "workers have", workers.length, "workers need", count, "parts", workCount, "rooms", myRooms.length, "spawns", spawns.length, "time to make", timetomake, myRooms.sort());
        const cs = Object.keys(Game.constructionSites).map(key => Game.constructionSites[key]).filter(cs => myRooms.includes(cs.pos.roomName) && cs.pos.roomName !== Memory.danger[controller.id]).sort(sortCS); 
        if(workers.length < count) {
            const base = [WORK, CARRY, MOVE]; //200
            const ext = [CARRY, CARRY, WORK, MOVE, MOVE, CARRY]; //350
            var body = base;
            var cost = 200;
            while((cost += 350) <= (workCount - 1) * 350 + 200 && workers.length >= count / 2) {
                body = [...body, ...ext];
            }
            var result = spawn.createCreep(body.slice(0, 50).sort(), Date().toString(), {
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
            var body = [TOUGH, TOUGH, MOVE, MOVE, MOVE, ATTACK];
            var base = [MOVE, RANGED_ATTACK, MOVE, HEAL]; //500
            var cost = body.reduce((cost, part) => BODYPART_COST[part] + cost, 0);
            var fighterExtCost = base.reduce((cost, part) => BODYPART_COST[part] + cost, 0);
            if((cost += fighterExtCost) <= room.energyCapacityAvailable && fighters.length >= fighterCount / 2) {
                body = [...body.slice(0, 50), ...base];
            }
            spawn.createCreep(body.sort((a, b) => BODYPART_COST[a] - BODYPART_COST[b]).slice(0, 50), Date().toString(), {
                type : "fighter",
                home : controller.id
            });
        }
        const hasExpander = !!creeps.find(creep => creep.memory.type === "expander");
        const unknown = myRooms.find(room => !Memory.sources[room]);
        if(!hasExpander && unknown) {
            spawn.createCreep([MOVE], Date().toString(), { 
                type : "expander",
                home : controller.id
            });
        }
        const reservers = creeps.filter(creep => creep.memory.type === "reserver");
        if(workers.length >= count && fighters.length >= fighterCount && reservers.length < myRooms.length - 1 && false) { //TODO
            const body = [MOVE, MOVE, CLAIM, CLAIM];
            spawn.createCreep(body, Date().toString(), {
                type : "reserver",
                home : controller.id
            });
        }
        const damaged = myRooms.map(key => Game.rooms[key]).filter(_ => _).reduce((damaged, room) => [...damaged, ...room.find(FIND_STRUCTURES, {
            filter : structure => structure.hits < structure.hitsMax
        })], []);
        const storage = room.find(FIND_STRUCTURES, filterStorage).sort((a, b) => (a.pos.x + a.pos.y * 50) - (b.pos.x + b.pos.y * 50)); 
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
                        
                        if(dropped.length) {
                            if(creep == dropped[0].pos.findClosestByPath(workers.filter(creep => creep.memory.isWorking))) {
                                creep.say("mine");
                                if(creep.pickup(dropped[0]) === ERR_NOT_IN_RANGE) {
                                    moveTo(creep, dropped[0]);
                                    break;
                                }
                            }
                        }
                        
                        var source;
                        if(!creep.memory.source) {
                            source = mySources.sort((a, b) => a.list.length - b.list.length).find(source => source.list.length < source.count);
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
                            creep.say(source.list.length + " / " + source.count);
                            source = Game.getObjectById(creep.memory.source);
                            if(creep.harvest(source)) {
                                moveTo(creep, source, {
                                    maxRooms : 1
                                });
                            }
                        }
                    } else {
                        
                        if(!creep.carry[RESOURCE_ENERGY]) {
                            const container = room.find(FIND_STRUCTURES, { filter : s => s.structureType === STRUCTURE_STORAGE})[0];
                            const resource = Object.keys(creep.carry).find(resource => creep.carry[resource]);
                            if(container && creep.transfer(container, resource) === ERR_NOT_IN_RANGE) {
                                moveTo(creep, container);
                            }
                            break;
                        }
                        
                        switch(storage.length ? creep.memory.id % 2 : 0) {
                            case 0 :
                                 if(cs.length && controller.ticksToDowngrade >= 1000) {
                                    var c = target(creep, cs.slice(0));
                                    if(creep.build(c) === ERR_NOT_IN_RANGE) {
                                        moveTo(creep, c);
                                    }
                                } else if(damaged.length && controller.ticksToDowngrade >= 1000) {
                                    var d = target(creep, damaged);
                                    if(creep.repair(d) === ERR_NOT_IN_RANGE) {
                                        moveTo(creep, d);
                                    }
                                    //damaged.splice(0, damaged.length);
                                } else if(creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
                                    moveTo(creep, controller);
                                }
                                break;
                            default :
                                if(!goToRoom(creep, room)) {
                                    var store = creep.pos.findClosestByPath(storage);
                                    var io = storage.indexOf(store);
                                    if(io => 0) {
                                        storage.splice(io, 1);
                                    }
                                    const canHandle = Math.max(0, Math.floor(creep.carry.energy / store.energyCapacity) - 1);
                                    storage.splice(0, canHandle);
                                    if(creep.transfer(store, RESOURCE_ENERGY) === OK) {
                                        creep.say(creep.room.energyAvailable + " + " + creep.carry.energy);
                                    } else {
                                        creep.say(canHandle);
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
    if(Game.flags.war) {
        if(typeof (getClosestSpawn(Game.flags.war.pos.roomName).createCreep([
            ...Array.from({length : 25}).map(_ => MOVE),
            ...Array.from({length : 25}).map(_ => Memory.invaders % 2 ? HEAL : ATTACK)
        ], Date().toString(), { //650
            type : "invader"
        })) === "string") {
            Memory.invaders++;
        }
    }
    const invaders = Object.keys(Game.creeps).map(key => Game.creeps[key]).filter(creep => creep.memory.type === "invader");
    invaders.forEach(invader => {
       if(!goToRoom(invader, Game.flags.war.pos.roomName)) {
           const roomToInvade = invader.room;
           const hostiles = [...roomToInvade.find(FIND_HOSTILE_STRUCTURES), ...roomToInvade.find(FIND_HOSTILE_CREEPS)];
           if(hostiles.length && invader.getActiveBodyparts(ATTACK)) {
               invader.memory.last = 3;
               const target = invader.pos.findClosestByRange(hostiles);
               if(invader.attack(target) === ERR_NOT_IN_RANGE) {
                   invader.moveTo(target);
               }
           } else if(!(invader.memory.last = Math.max(invader.memory.last - 1, 0))) {
               invader.moveTo(25, 25);
           }
       }
       if(invader.getActiveBodyparts(HEAL)) {
           const damaged = invader.room.find(FIND_MY_CREEPS).filter(invader => invader.hits < invader.hitsMax);
           if(invader.heal(damaged[0])) {
               invader.rangedHeal(damaged[0]);
               moveTo(invader, damaged[0]);
           }
       }
    });
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
        addSite(room, STRUCTURE_TERMINAL);
        addSite(room, STRUCTURE_NUKER);
        addSite(room, STRUCTURE_OBSERVER);
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
    });
}
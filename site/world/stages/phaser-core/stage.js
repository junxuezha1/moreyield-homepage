import * as Phaser from "../../vendor/phaser.esm.js";
import { createNpcBehavior } from "../../src/npc-behavior.js";

const WORLD_WIDTH = 3840;
const WORLD_HEIGHT = 2160;
const VIEW_WIDTH = 1280;
const VIEW_HEIGHT = 720;
const INTERIOR_CAMERA_ZOOM = 0.44;
const CAMERA_FOLLOW_OFFSET_Y = 328;
const TILE_SIZE = 8;
// Keep authored actor dimensions stable in the world when the camera zooms.
const ACTOR_WORLD_SCALE = 1 / 0.84;
const PLAYER_BODY_WORLD_WIDTH = 42;
const PLAYER_BODY_WORLD_HEIGHT = 96;
const FALL_RESPAWN_Y = WORLD_HEIGHT + 160;
const RESPAWN_HOLD_MS = 260;
const ASSET_ROOT = new URL("../../public/assets/", import.meta.url);
const assetUrl = (path) => new URL(path, ASSET_ROOT).href;
const BACKGROUND_SRC = assetUrl("interior-scene-landmarks.png");
const MOUNTAIN_TITLE_SRC = assetUrl("moreyield-mountain-title.png");
const PLAYER_SRC = assetUrl("characters/v5/player/right/02.png");
const NPC_SRC = assetUrl("characters/v5/npc/right/02.png");
const TILEMAP_SRC = "world/interior-walkway-tilemap.json";
const TILEMAP_URL = new URL("./world/interior-walkway-tilemap.json", import.meta.url).href;
const SURFACE_TRUTH_URL = new URL("./world/interior-walkway-truth.json", import.meta.url).href;
const MOVE_SPEED = 280;
const NPC_MOVE_SPEED = 116;
const NPC_PATROL_BOUNDS = Object.freeze({ left: 64, right: WORLD_WIDTH - 64 });
const NPC_PATROL_STOPS = Object.freeze([128, 512, 800, 1120, 1584, 1936, 2144, 2480, 2864, 3216, 3424, 3712]);
const AUTO_STEP_HEIGHT = TILE_SIZE;
const INTERACTION_DISTANCE = 112;
const INTERACTION_OBJECTS = Object.freeze([
  { triggerId: "interior.npc-moreyield", label: "Moreyield", kind: "npc", x: 800 },
  { triggerId: "interior.project-workstation", label: "作品布告栏", kind: "workstation", x: 2144, texture: "projectNoticeboard", height: 150 },
  { triggerId: "interior.contact-mailbox", label: "联系邮筒", kind: "mailbox", x: 2480, texture: "contactPostbox", height: 114 }
]);
const ACTOR_DIRECTIONS = Object.freeze(["left", "right"]);
const ACTOR_FRAME_COUNT = 4;

function actorFrameSrc(actor, direction, index) {
  return assetUrl(`characters/v5/${actor}/${direction}/${String(index).padStart(2, "0")}.png`);
}

class CoreScene extends Phaser.Scene {
  constructor({ ui, publishRuntime, onReady, onFailure, onInteraction, onInteractionStateChange, onLifeStateChange, onSound } = {}) {
    super("core");
    this.ui = ui || {};
    this.publishRuntime = publishRuntime;
    this.onRuntimeReady = onReady;
    this.onRuntimeFailure = onFailure;
    this.onInteraction = onInteraction;
    this.onInteractionStateChange = onInteractionStateChange;
    this.onSound = onSound;
    this.onLifeStateChange = onLifeStateChange;
    this.debugEnabled = false;
    this.runtimeInput = { left: false, right: false, jump: false };
    this.interactionBlocked = false;
    this.nearbyInteraction = null;
    this.previousJumpInput = false;
    this.spawnPoint = { x: 2880, y: 1184 };
    this.waterfallVoid = null;
    this.bridge = null;
    this.lifeState = "ready";
    this.lastFailure = null;
    this.pendingFallReason = null;
    this.respawnCount = 0;
    this.solidTileCount = 0;
    this.voidSolidTileCount = 0;
    this.autoStepCount = 0;
    this.lastAutoStep = null;
    this.playerMotionState = "idle";
    this.playerFacing = "right";
    this.lifecycleDisposed = false;
    this.handleLifecycleEnd = () => this.disposeLifecycle();
  }

  preload() {
    this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, (file) => {
      this.onRuntimeFailure?.(new Error(`Phaser asset failed to load: ${file?.src || file?.key || "unknown"}`));
    });
    this.load.image("interiorScene", BACKGROUND_SRC);
    this.load.image("mountainTitle", MOUNTAIN_TITLE_SRC);
    this.load.image("projectNoticeboard", assetUrl("landmarks/noticeboard.png"));
    this.load.image("contactPostbox", assetUrl("landmarks/mailbox.png"));
    this.load.image("playerRight", PLAYER_SRC);
    this.load.image("npcMoreyield", NPC_SRC);
    for (const actor of ["player", "npc"]) {
      for (const direction of ACTOR_DIRECTIONS) {
        for (let index = 1; index <= ACTOR_FRAME_COUNT; index += 1) {
          this.load.image(`${actor}-walk-${direction}-${index}`, actorFrameSrc(actor, direction, index));
        }
      }
    }
    this.load.json("surfaceTilemap", TILEMAP_URL);
    this.load.json("surfaceTruth", SURFACE_TRUTH_URL);
  }

  create() {
    window.__phaserCoreScene = this;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleLifecycleEnd);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.handleLifecycleEnd);
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.physics.world.setBoundsCollision(true, true, true, false);
    this.cameras.main.setZoom(INTERIOR_CAMERA_ZOOM);
    this.updateCameraBounds();
    this.cameras.main.roundPixels = false;
    this.add.image(0, 0, "interiorScene").setOrigin(0).setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT);
    this.mountainTitle = this.add.image(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, "mountainTitle")
      .setScrollFactor(0).setAlpha(0.96);
    this.layoutMountainTitle();

    this.createCollisionTilemap();
    this.createVisibleWalkway();
    this.createActorAnimations();
    this.createPlayer();
    this.createInteractionObjects();
    this.createControls();
    this.debugGraphics = this.add.graphics().setDepth(100);
    this.installRuntime();
    this.cameras.main.startFollow(this.player, false, 0.12, 0.12);
    this.cameras.main.setFollowOffset(0, CAMERA_FOLLOW_OFFSET_Y);
    this.cameras.main.setDeadzone(180, 120);
    this.resetRuntime();
    // Re-apply the spawn after the first scene tick so a fresh mount cannot
    // slip through the tilemap before Arcade has built its collision faces.
    this.events.once(Phaser.Scenes.Events.POST_UPDATE, () => this.resetRuntime());
    this.onRuntimeReady?.(this.runtime, this);
  }

  update(_time, delta) {
    if (this.lifecycleDisposed || this.lifeState === "respawning") return;
    this.updateCameraBounds();
    this.settleWalkwayDescent();
    const body = this.player.body;
    const onGround = this.isPlayerGrounded();
    const moveLeft = !this.interactionBlocked && (this.cursors.left.isDown || this.keys.left.isDown || this.runtimeInput.left);
    const moveRight = !this.interactionBlocked && (this.cursors.right.isDown || this.keys.right.isDown || this.runtimeInput.right);
    const runtimeJumpPressed = this.runtimeInput.jump && !this.previousJumpInput;
    const jumpPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
      Phaser.Input.Keyboard.JustDown(this.cursors.space) ||
      Phaser.Input.Keyboard.JustDown(this.keys.jump) ||
      runtimeJumpPressed;

    const moveDirection = moveLeft === moveRight ? 0 : (moveLeft ? -1 : 1);
    if (moveDirection !== 0) this.tryAutoStep(moveDirection);
    if (moveDirection < 0) body.setVelocityX(-MOVE_SPEED);
    else if (moveDirection > 0) body.setVelocityX(MOVE_SPEED);
    else body.setVelocityX(0);
    const didJump = jumpPressed && onGround && !this.interactionBlocked;
    if (didJump) {
      body.setVelocityY(-980);
      this.onSound?.("jump");
      this.audioAirborne = true;
    }
    this.updateMovementSound(onGround && !didJump, moveDirection);

    const feet = this.getFeet();
    if (!onGround && this.isInsideWaterfallVoid(feet.x)) {
      if (this.lifeState !== "falling") this.pendingFallReason = "waterfall_void";
      this.setLifeState("falling", { reason: this.pendingFallReason });
    }
    else if (onGround && this.lifeState !== "respawned") this.setLifeState("ready");
    if (body.top > FALL_RESPAWN_Y) this.respawnAfterFall(feet);

    this.previousJumpInput = this.runtimeInput.jump;
    this.previousPlayerGrounded = this.isPlayerGrounded() && body.velocity.y >= 0;
    this.updatePlayerAnimation(moveDirection, delta);
    const npc = this.interactionObjects.find((item) => item.kind === "npc");
    this.npcBehavior.setPlayerNear(Math.hypot(npc.x - feet.x, npc.y - feet.y) <= INTERACTION_DISTANCE + 40);
    this.npcBehavior.update(delta);
    const npcDistance = Math.abs(npc.x - (this.previousNpcX ?? npc.x));
    npc.actorSprite.anims.timeScale = Math.min(1.5, npcDistance / Math.max(0.01, NPC_MOVE_SPEED * delta / 1000));
    this.previousNpcX = npc.x;
    this.updateInteractionState();
    this.updateHud();
  }

  createActorAnimations() {
    for (const actor of ["player", "npc"]) {
      for (const direction of ACTOR_DIRECTIONS) {
        this.anims.create({
          key: `${actor}-walk-${direction}`,
          frames: Array.from({ length: ACTOR_FRAME_COUNT }, (_, index) => ({
            key: `${actor}-walk-${direction}-${index + 1}`
          })),
          frameRate: actor === "player" ? 8 : 8 * NPC_MOVE_SPEED / MOVE_SPEED,
          repeat: -1
        });
      }
    }
  }

  updateMovementSound(grounded, direction) {
    const x = this.player.body.center.x;
    const distance = Math.abs(x - (this.audioPreviousX ?? x));
    this.audioPreviousX = x;
    if (this.interactionBlocked) {
      this.audioStepDistance = 0;
      return;
    }
    if (!grounded) {
      if (this.player.body.velocity.y > 180) this.audioAirborne = true;
      this.audioStepDistance = 0;
      return;
    }
    if (this.audioAirborne) {
      this.onSound?.("land");
      this.audioAirborne = false;
      this.audioStepDistance = 0;
      return;
    }
    if (!direction || distance > 32) {
      this.audioStepDistance = 0;
      return;
    }
    this.audioStepDistance = (this.audioStepDistance || 0) + distance;
    if (this.audioStepDistance >= 72) {
      this.audioStepDistance %= 72;
      this.onSound?.("step");
    }
  }

  updateCameraBounds() {
    const camera = this.cameras.main;
    const viewportKey = `${window.innerWidth}:${window.innerHeight}:${camera.zoom}`;
    if (viewportKey === this.cameraViewportKey) return;
    const canvas = this.game.canvas.getBoundingClientRect();
    const host = this.game.canvas.parentElement.getBoundingClientRect();
    if (!canvas.width || !canvas.height || !host.width || !host.height) return;
    // CSS cover crops the fixed-format canvas. Only the visible part should
    // constrain the camera, or edge landmarks leave a narrow screen.
    const paddingX = Math.max(0, canvas.width - host.width) / canvas.width * VIEW_WIDTH / camera.zoom / 2;
    const paddingY = Math.max(0, canvas.height - host.height) / canvas.height * VIEW_HEIGHT / camera.zoom / 2;
    camera.setBounds(-paddingX, -paddingY, WORLD_WIDTH + paddingX * 2, WORLD_HEIGHT + paddingY * 2);
    this.visibleWorldWidth = Math.min(1, host.width / canvas.width) * VIEW_WIDTH / camera.zoom;
    this.layoutMountainTitle();
    this.cameraViewportKey = viewportKey;
  }

  layoutMountainTitle() {
    if (!this.mountainTitle || !this.visibleWorldWidth) return;
    // Fixed in the visible canvas center; camera movement never moves this title.
    const width = Math.min(2100, this.visibleWorldWidth * 0.91);
    this.mountainTitle.setScale(width / this.mountainTitle.width);
  }

  settleWalkwayDescent() {
    const body = this.player.body;
    if (!this.previousPlayerGrounded || body.velocity.y < 0 || this.interactionBlocked) return;
    let supportY = Infinity;
    const left = Math.max(0, Math.floor(body.left / TILE_SIZE));
    const right = Math.min(this.tilemap.width - 1, Math.floor((body.right - 0.001) / TILE_SIZE));
    for (let column = left; column <= right; column += 1) {
      const groundY = this.getGroundYAt(column * TILE_SIZE + TILE_SIZE / 2, 0);
      if (!Number.isFinite(groundY)) return;
      supportY = Math.min(supportY, groundY);
    }
    const drop = supportY - body.bottom;
    const travelled = Math.abs(body.center.x - (this.previousPlayerMotionX ?? body.center.x));
    if (drop <= 0 || drop > AUTO_STEP_HEIGHT + travelled) return;
    this.positionBodyCenter(body.center.x, supportY - body.height / 2);
    body.setVelocityY(0);
    body.blocked.down = true;
  }

  createInteractionObjects() {
    this.interactionObjects = INTERACTION_OBJECTS.map((definition) => {
      const y = this.getGroundYAt(definition.x, 0);
      if (!Number.isFinite(y)) throw new Error(`Interaction ${definition.triggerId} has no walkable surface.`);

      const children = [];
      if (definition.kind === "npc") {
        const actorSprite = this.add.sprite(0, 0, "npcMoreyield")
          .setOrigin(0.5, 1)
          .setScale(ACTOR_WORLD_SCALE);
        children.push(actorSprite);
        definition = { ...definition, actorSprite };
      } else {
        const landmarkSprite = this.add.sprite(0, 0, definition.texture).setOrigin(0.5, 1);
        landmarkSprite.setScale(definition.height / landmarkSprite.height);
        children.push(landmarkSprite);
        definition = { ...definition, width: landmarkSprite.displayWidth, landmarkSprite };
      }
      const height = definition.kind === "npc" ? 142 : definition.height;
      children.push(this.add.text(0, -height - 12, definition.label, {
        backgroundColor: "#101817dd",
        color: "#fff0a0",
        fontFamily: "monospace",
        fontSize: "22px",
        padding: { x: 7, y: 4 }
      }).setOrigin(0.5, 1));

      const object = this.add.container(definition.x, y, children).setDepth(3);
      const width = Math.max(112, definition.width || 112);
      object.setInteractive({
        hitArea: new Phaser.Geom.Rectangle(-width / 2, -height - 48, width, height + 48),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        cursor: "pointer"
      });
      object.on("pointerdown", () => this.activateInteraction(definition.triggerId, "pointer"));
      return { ...definition, y, object };
    });
    this.createNpcPatrol();
  }

  createNpcPatrol() {
    const npc = this.interactionObjects.find((item) => item.triggerId === "interior.npc-moreyield");
    const applyState = (state) => {
      if (this.lifecycleDisposed || !npc.actorSprite?.active) return;
      const normalized = state === "walk-left" || state === "walk-right" ? state : "idle";
      npc.motionState = normalized;
      if (normalized === "idle") {
        npc.actorSprite.stop().setTexture(`npc-walk-${npc.facing || "right"}-2`);
      } else {
        npc.facing = normalized === "walk-left" ? "left" : "right";
        npc.actorSprite.play(`npc-${normalized}`, true);
      }
    };
    this.npcBehavior = createNpcBehavior({
      getPosition: () => ({ x: npc.x, y: npc.y }),
      setPosition: (x) => {
        if (this.lifecycleDisposed || !npc.object?.active) return;
        const y = this.getGroundYAt(x, 0);
        if (!Number.isFinite(y) || this.isInsideWaterfallVoid(x)) return;
        npc.x = x;
        npc.y = y;
        npc.object.setPosition(x, y);
      },
      bounds: NPC_PATROL_BOUNDS,
      groundY: (x) => this.lifecycleDisposed ? npc.y : this.getGroundYAt(x, 0),
      speedRange: { min: 90, max: 150 },
      patrolStops: NPC_PATROL_STOPS,
      autoUpdate: false,
      onStateChange: applyState
    });
    applyState("idle");
    this.npcBehavior.start();
  }

  disposeLifecycle() {
    if (this.lifecycleDisposed) return;
    this.lifecycleDisposed = true;
    this.npcBehavior?.destroy();
    this.ui.debugToggle?.removeEventListener("click", this.handleDebugToggle);
    this.publishRuntime = null;
    this.onInteraction = null;
    this.onInteractionStateChange = null;
    this.onSound = null;
  }

  updatePlayerAnimation(moveDirection, delta = 16.67) {
    let nextState = "idle";
    const previousFacing = this.playerFacing;
    if (moveDirection) this.playerFacing = moveDirection < 0 ? "left" : "right";
    if (moveDirection < 0) nextState = "walk-left";
    else if (moveDirection > 0) nextState = "walk-right";
    if (!this.isPlayerGrounded()) nextState = this.player.body.velocity.y < 0 ? "jump" : "fall";
    const travelled = Math.abs(this.player.body.center.x - (this.previousPlayerMotionX ?? this.player.body.center.x));
    this.previousPlayerMotionX = this.player.body.center.x;
    this.player.anims.timeScale = Math.min(1.5, travelled / Math.max(0.01, MOVE_SPEED * delta / 1000));
    if (nextState === this.playerMotionState && this.playerFacing === previousFacing) return;
    this.playerMotionState = nextState;
    if (nextState.startsWith("walk")) this.player.play(`player-${nextState}`, true);
    else this.player.stop().setTexture(`player-walk-${this.playerFacing}-${nextState === "jump" ? 1 : nextState === "fall" ? 3 : 2}`);
  }

  evaluateAutoStep(currentGroundY, targetGroundY, targetX) {
    const rise = Number(currentGroundY) - Number(targetGroundY);
    const allowed = Number.isFinite(rise) && rise > 0 && rise <= AUTO_STEP_HEIGHT && !this.isInsideWaterfallVoid(targetX);
    return { allowed, rise, maxHeight: AUTO_STEP_HEIGHT, targetX, voidBlocked: this.isInsideWaterfallVoid(targetX) };
  }

  tryAutoStep(direction) {
    if (!this.isPlayerGrounded() || this.interactionBlocked) return false;
    const body = this.player.body;
    const currentGroundY = body.bottom;
    const targetX = direction < 0 ? body.left - 2 : body.right + 2;
    const targetGroundY = this.getGroundYAt(targetX, 0);
    const decision = this.evaluateAutoStep(currentGroundY, targetGroundY, targetX);
    if (!decision.allowed) return false;

    this.positionBodyCenter(body.center.x, targetGroundY - body.height / 2);
    this.player.body.setVelocityX(direction * MOVE_SPEED);
    this.player.body.blocked.down = true;
    this.autoStepCount += 1;
    this.lastAutoStep = { fromY: currentGroundY, toY: targetGroundY, ...decision };
    return true;
  }

  updateInteractionState() {
    const feet = this.getFeet();
    let nearest = null;
    for (const interaction of this.interactionObjects || []) {
      const distance = Math.hypot(feet.x - interaction.x, feet.y - interaction.y);
      if (distance <= INTERACTION_DISTANCE && (!nearest || distance < nearest.distance)) {
        nearest = { ...interaction, distance };
      }
    }
    const previousId = this.nearbyInteraction?.triggerId || null;
    const nextId = nearest?.triggerId || null;
    this.nearbyInteraction = nearest;
    if (previousId !== nextId) this.publishInteractionState();
    if (!this.interactionBlocked && nearest && Phaser.Input.Keyboard.JustDown(this.keys.interact)) {
      this.activateInteraction(nearest.triggerId, "keyboard");
    }
  }

  activateInteraction(triggerId, input) {
    if (this.interactionBlocked) return false;
    const interaction = this.interactionObjects?.find((item) => item.triggerId === triggerId);
    if (!interaction) return false;
    this.onInteraction?.({ triggerId, input, x: interaction.x, y: interaction.y });
    return true;
  }

  publishInteractionState() {
    this.onInteractionStateChange?.(this.nearbyInteraction
      ? {
          triggerId: this.nearbyInteraction.triggerId,
          label: this.nearbyInteraction.label,
          distance: this.nearbyInteraction.distance
        }
      : null);
  }

  createCollisionTilemap() {
    const source = this.cache.json.get("surfaceTilemap");
    const terrain = source.layers.find((layer) => layer.name === "terrain_solid");
    const objects = source.layers.find((layer) => layer.name === "surface_objects")?.objects;
    if (!terrain || !objects) throw new Error("Tilemap terrain or object layer is missing.");
    const rows = Array.from({ length: source.height }, (_, y) =>
      terrain.data.slice(y * source.width, (y + 1) * source.width).map((value) => (value === 1 ? 0 : -1))
    );
    this.tilemap = this.make.tilemap({
      data: rows,
      tileWidth: source.tilewidth,
      tileHeight: source.tileheight
    });
    if (
      this.tilemap.widthInPixels !== WORLD_WIDTH ||
      this.tilemap.heightInPixels !== WORLD_HEIGHT ||
      this.tilemap.tileWidth !== TILE_SIZE ||
      this.tilemap.tileHeight !== TILE_SIZE
    ) {
      throw new Error("Surface tilemap dimensions do not match the 3840x2160 8px-grid contract.");
    }

    const texture = this.make.graphics({ add: false });
    texture.fillStyle(0xffffff, 1).fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    texture.generateTexture("collisionTile", TILE_SIZE, TILE_SIZE);
    texture.destroy();
    const tileset = this.tilemap.addTilesetImage("collisionTile", "collisionTile", TILE_SIZE, TILE_SIZE);
    if (!tileset) throw new Error("Runtime collision tileset could not be created.");
    this.terrainLayer = this.tilemap.createLayer(0, tileset, 0, 0);
    if (!this.terrainLayer) throw new Error("Runtime TilemapLayer could not be created.");
    this.terrainLayer.setCollision(0).setVisible(false);

    const spawn = objects.find((object) => object.type === "spawn");
    const bridge = objects.find((object) => object.type === "bridge");
    if (!spawn || !bridge) throw new Error("Tilemap spawn or scenic bridge is missing.");
    const truthSpawn = this.cache.json.get("surfaceTruth")?.spawn;
    if (truthSpawn?.x !== spawn.x || truthSpawn?.y !== spawn.y) {
      throw new Error("Truth and tilemap spawn coordinates disagree.");
    }
    this.spawnPoint = { x: spawn.x, y: spawn.y };
    this.bridge = { ...this.cache.json.get("surfaceTruth").bridge };
    if (bridge.x !== this.bridge.x || bridge.y !== this.bridge.surfaceY || bridge.width !== this.bridge.width) {
      throw new Error("Truth and Tilemap bridge coordinates disagree.");
    }
    this.waterfallVoid = null;

    this.solidTileCount = this.terrainLayer.filterTiles((tile) => tile.collides).length;
    this.voidSolidTileCount = 0;
    for (let x = this.bridge.x; x < this.bridge.x + this.bridge.width; x += TILE_SIZE) {
      if (this.getGroundYAt(x + TILE_SIZE / 2, 0) !== this.bridge.surfaceY) {
        throw new Error("Scenic bridge has a gap in its walkable surface.");
      }
    }
  }

  createPlayer() {
    this.player = this.physics.add.sprite(this.spawnPoint.x, this.spawnPoint.y, "playerRight");
    const actorScale = ACTOR_WORLD_SCALE;
    this.player.setOrigin(0.5, 1).setScale(actorScale).setDepth(4);
    const frame = this.player.frame;
    // V5 frames end at the visible sole and share the same registered head center.
    // Arcade's body and the artwork therefore use the same foot anchor.
    const bodySourceWidth = PLAYER_BODY_WORLD_WIDTH / actorScale;
    const bodySourceHeight = PLAYER_BODY_WORLD_HEIGHT / actorScale;
    this.player.body.setSize(bodySourceWidth, bodySourceHeight);
    this.player.body.setOffset(
      (frame.realWidth - bodySourceWidth) / 2,
      frame.realHeight - bodySourceHeight
    );
    this.player.body.setCollideWorldBounds(true);
    this.player.body.setMaxVelocity(620, 1100);
    this.physics.add.collider(this.player, this.terrainLayer);
  }

  createVisibleWalkway() {
    const columns = [];
    for (let x = 0; x < WORLD_WIDTH; x += TILE_SIZE) {
      const y = this.getGroundYAt(x + TILE_SIZE / 2, 0);
      if (Number.isFinite(y)) columns.push({ x, y });
    }
    const minY = Math.min(...columns.map(({ y }) => y));
    const maxY = Math.max(...columns.map(({ y }) => y));
    const artwork = this.make.graphics({ add: false });
    for (const { x, y } of columns) {
      const localY = y - minY;
      // Every visible top begins at the exact collider top. The painted scene
      // remains scenery, while the mossy stone lip identifies the playable path.
      artwork.fillStyle(0x233b32).fillRect(x, localY, TILE_SIZE, 18);
      artwork.fillStyle((x / TILE_SIZE) % 3 ? 0x66745a : 0x718064).fillRect(x, localY + 3, TILE_SIZE - 1, 9);
      artwork.fillStyle(0xb8ca7a).fillRect(x, localY, TILE_SIZE, 2);
      artwork.fillStyle(0x749954).fillRect(x, localY + 2, TILE_SIZE, 2);
      artwork.fillStyle(0x3c5940).fillRect(x + 2, localY + 12, 5, (x / TILE_SIZE) % 2 ? 3 : 5);
    }
    artwork.generateTexture("walkwaySurface", WORLD_WIDTH, maxY - minY + 24);
    artwork.destroy();
    this.add.image(0, minY, "walkwaySurface").setOrigin(0).setDepth(2).setVisible(false);
    this.walkwaySurface = { source: TILEMAP_SRC, columns: columns.length, gridSize: TILE_SIZE, visible: false };
  }

  createControls() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      jump: Phaser.Input.Keyboard.KeyCodes.W,
      interact: Phaser.Input.Keyboard.KeyCodes.E
    });
    this.handleKeyboardDebugToggle = () => this.setCollisionDebugVisible(!this.debugEnabled);
    this.input.keyboard.on("keydown-F3", this.handleKeyboardDebugToggle);
    this.handleDebugToggle = () => this.setCollisionDebugVisible(!this.debugEnabled);
    this.ui.debugToggle?.addEventListener("click", this.handleDebugToggle);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard.off("keydown-F3", this.handleKeyboardDebugToggle);
      this.ui.debugToggle?.removeEventListener("click", this.handleDebugToggle);
    });
  }

  setCollisionDebugVisible(visible) {
    this.debugEnabled = Boolean(visible);
    this.debugGraphics.clear();
    if (this.debugEnabled) {
      this.terrainLayer.renderDebug(this.debugGraphics, {
        tileColor: null,
        collidingTileColor: new Phaser.Display.Color(102, 217, 239, 96),
        faceColor: new Phaser.Display.Color(255, 95, 95, 255)
      });
      this.debugGraphics.lineStyle(4, 0xff5f5f, 1).strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    }
    if (this.ui.debugState) this.ui.debugState.textContent = `Debug: ${this.debugEnabled ? "on" : "off"}`;
    this.ui.debugToggle?.setAttribute("aria-pressed", String(this.debugEnabled));
  }

  installRuntime() {
    const runtime = {
      version: "1.2.0",
      ready: true,
      getSnapshot: () => this.getRuntimeSnapshot(),
      reset: () => this.resetRuntime(),
      screenToWorld: (point) => this.screenToWorld(point),
      activateInteraction: (triggerId) => this.activateInteraction(triggerId, "runtime"),
      evaluateAutoStep: (input = {}) => this.evaluateAutoStep(input.currentGroundY, input.targetGroundY, input.targetX),
      setCollisionDebugVisible: (visible) => this.setCollisionDebugVisible(visible),
      setInput: (input) => this.setRuntimeInput(input),
      setInteractionBlocked: (blocked) => this.setInteractionBlocked(blocked),
      worldToScreen: (point) => this.worldToScreen(point)
    };
    this.runtime = runtime;
    this.publishRuntime?.(runtime);
  }

  setLifeState(nextState, detail = {}) {
    if (this.lifeState === nextState) return;
    const previousState = this.lifeState;
    this.lifeState = nextState;
    this.onLifeStateChange?.({
      state: nextState,
      previousState,
      reason: detail.reason || this.lastFailure?.reason || this.pendingFallReason || null,
      respawnCount: this.respawnCount
    });
  }

  resetRuntime(options = {}) {
    this.setRuntimeInput();
    this.previousJumpInput = false;
    this.positionBodyCenter(this.spawnPoint.x, this.spawnPoint.y);
    // Resolve the spawn body against the first solid tile immediately. This
    // keeps a fresh mount grounded before the first Arcade physics step.
    this.physics.world.collide(this.player, this.terrainLayer);
    this.player.body.setVelocity(0, 0);
    this.previousPlayerMotionX = this.spawnPoint.x;
    this.previousPlayerGrounded = false;
    this.audioPreviousX = this.spawnPoint.x;
    this.audioStepDistance = 0;
    this.audioAirborne = false;
    this.player.setAlpha(1);
    this.setLifeState(options.lifeState || "ready");
    this.pendingFallReason = null;
    this.autoStepCount = 0;
    this.lastAutoStep = null;
    if (!options.preserveFailure) this.lastFailure = null;
    this.cameras.main.centerOn(this.player.x, this.player.y - CAMERA_FOLLOW_OFFSET_Y);
    this.updateHud();
    return this.getRuntimeSnapshot();
  }

  positionBodyCenter(x, y) {
    const body = this.player.body;
    // Reset both body history and sprite position so postUpdate cannot reapply
    // the pre-step delta when a stair or respawn changes the body's position.
    body.reset(x, y + body.height / 2);
    body.updateFromGameObject();
    body.prev.copy(body.position);
    body.prevFrame.copy(body.position);
    body.autoFrame.copy(body.position);
  }

  respawnAfterFall(feet) {
    if (this.lifeState === "respawning") return;
    this.lastFailure = {
      reason: this.pendingFallReason || (this.isInsideWaterfallVoid(feet.x) ? "waterfall_void" : "world_fall"),
      feetX: feet.x,
      feetY: feet.y
    };
    this.respawnCount += 1;
    this.setLifeState("respawning", { reason: this.lastFailure.reason });
    this.setRuntimeInput();
    this.player.body.enable = false;
    this.player.setAlpha(0);
    this.updateHud();
    this.time.delayedCall(RESPAWN_HOLD_MS, () => {
      if (this.lifecycleDisposed) return;
      this.player.body.enable = true;
      this.positionBodyCenter(this.spawnPoint.x, this.spawnPoint.y);
      this.physics.world.collide(this.player, this.terrainLayer);
      this.player.body.setVelocity(0, 0);
      this.player.setAlpha(1);
      this.setLifeState("respawned", { reason: this.lastFailure.reason });
      this.cameras.main.centerOn(this.player.x, this.player.y - CAMERA_FOLLOW_OFFSET_Y);
      this.updateHud();
    });
  }

  setRuntimeInput(input = {}) {
    this.runtimeInput = {
      left: Boolean(input.left),
      right: Boolean(input.right),
      jump: Boolean(input.jump)
    };
  }

  setInteractionBlocked(blocked) {
    this.interactionBlocked = Boolean(blocked);
    this.setRuntimeInput();
    if (this.interactionBlocked) {
      this.input.keyboard.resetKeys();
      this.player.body.setVelocityX(0);
      this.updatePlayerAnimation(0);
      this.physics.world.pause();
    } else if (!this.lifecycleDisposed) {
      this.physics.world.resume();
    }
    this.npcBehavior?.setInteracting(this.interactionBlocked);
    return this.getRuntimeSnapshot();
  }

  isPlayerGrounded() {
    const body = this.player.body;
    return body.blocked.down || body.touching.down;
  }

  isInsideWaterfallVoid(x) {
    return this.waterfallVoid !== null && x >= this.waterfallVoid.x && x < this.waterfallVoid.x + this.waterfallVoid.width;
  }

  getFeet() {
    return { x: this.player.body.center.x, y: this.player.body.bottom };
  }

  getGroundYAt(x, feetY) {
    if (this.lifecycleDisposed || !this.tilemap || !this.terrainLayer?.active) return null;
    const tileX = this.tilemap.worldToTileX(x, true);
    if (tileX < 0 || tileX >= this.tilemap.width) return null;
    const startY = Math.max(0, this.tilemap.worldToTileY(feetY - TILE_SIZE, true));
    for (let tileY = startY; tileY < this.tilemap.height; tileY += 1) {
      const tile = this.terrainLayer.getTileAt(tileX, tileY);
      if (tile?.collides) return tile.pixelY;
    }
    return null;
  }

  screenToWorld(point = {}) {
    const bounds = this.game.canvas.getBoundingClientRect();
    const localX = ((Number(point.x) - bounds.left) / bounds.width) * this.scale.gameSize.width;
    const localY = ((Number(point.y) - bounds.top) / bounds.height) * this.scale.gameSize.height;
    const worldPoint = this.cameras.main.getWorldPoint(localX, localY);
    return { x: worldPoint.x, y: worldPoint.y };
  }

  worldToScreen(point = {}) {
    const camera = this.cameras.main;
    const bounds = this.game.canvas.getBoundingClientRect();
    const localX = (Number(point.x) - camera.worldView.x) * camera.zoom;
    const localY = (Number(point.y) - camera.worldView.y) * camera.zoom;
    return {
      x: bounds.left + (localX / this.scale.gameSize.width) * bounds.width,
      y: bounds.top + (localY / this.scale.gameSize.height) * bounds.height
    };
  }

  countDebugOverlayPixels() {
    if (!this.debugEnabled) return 0;
    const canvas = this.game.canvas;
    const data = canvas.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      if (red > 180 && green < 140 && blue < 160) count += 1;
      else if (red < 150 && green > 160 && blue > 170) count += 1;
    }
    return count;
  }

  getRuntimeSnapshot() {
    const body = this.player.body;
    const feet = this.getFeet();
    const groundY = this.getGroundYAt(feet.x, feet.y);
    const npcState = this.npcBehavior?.getState();
    return {
      ready: true,
      sceneKey: "phaser-core",
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
      player: {
        x: body.center.x,
        y: body.center.y,
        vx: body.velocity.x,
        vy: body.velocity.y,
        onGround: this.isPlayerGrounded(),
        spawnX: this.spawnPoint.x,
        spawnY: this.spawnPoint.y,
        authoredSpawnX: this.spawnPoint.x,
        authoredSpawnY: this.spawnPoint.y,
        spawnSemantic: "body-center",
        feetX: feet.x,
        feetY: feet.y,
        bodyWidth: body.width,
        bodyHeight: body.height
      },
      camera: {
        scrollX: this.cameras.main.scrollX,
        scrollY: this.cameras.main.scrollY,
        zoom: this.cameras.main.zoom,
        authoredZoom: INTERIOR_CAMERA_ZOOM,
        actorWorldScale: ACTOR_WORLD_SCALE,
        followOffsetY: CAMERA_FOLLOW_OFFSET_Y
      },
      collision: {
        source: TILEMAP_SRC,
        debugVisible: this.debugEnabled,
        layerCount: 1,
        solidColliderCount: this.solidTileCount,
        waterfallVoidColliderCount: this.voidSolidTileCount,
        debugOverlayPixelCount: this.countDebugOverlayPixels(),
        groundYAtPlayerFeet: groundY
      },
      walkway: this.walkwaySurface,
      ground: { yAtPlayerFeet: groundY },
      failure: {
        state: this.lifeState,
        respawnCount: this.respawnCount,
        last: this.lastFailure
      },
      waterfallVoid: this.waterfallVoid,
      bridge: { ...this.bridge },
      background: {
        src: BACKGROUND_SRC,
        naturalWidth: WORLD_WIDTH,
        naturalHeight: WORLD_HEIGHT,
        worldWidth: WORLD_WIDTH,
        worldHeight: WORLD_HEIGHT
      },
      playerSprite: {
        src: PLAYER_SRC,
        source: "v5",
        isPlaceholder: false,
        frameWidth: this.player.frame.realWidth,
        frameHeight: this.player.frame.realHeight,
        displayWidth: this.player.displayWidth,
        displayHeight: this.player.displayHeight
      },
      actors: {
        motionSource: "src/actor-motion-manifest-v5.json",
        speedSource: "stages/phaser-core/stage.js",
        player: {
          feetY: feet.y,
          groundY,
          state: this.playerMotionState,
          animationKey: this.player.anims.currentAnim?.key || "idle",
          frameIndex: this.player.anims.currentFrame?.index ?? 0,
          frameCount: this.player.anims.currentAnim?.frames?.length || 1,
        fps: this.player.anims.currentAnim?.frameRate || 1,
          speed: MOVE_SPEED
        },
        npc: {
          x: this.interactionObjects?.find((item) => item.triggerId === "interior.npc-moreyield")?.x,
          feetY: this.interactionObjects?.find((item) => item.triggerId === "interior.npc-moreyield")?.y,
          groundY: this.getGroundYAt(
            this.interactionObjects?.find((item) => item.triggerId === "interior.npc-moreyield")?.x,
            0
          ),
          state: npcState?.state || "idle",
          animationKey: this.interactionObjects?.find((item) => item.triggerId === "interior.npc-moreyield")?.actorSprite?.anims.currentAnim?.key || "idle",
          frameIndex: this.interactionObjects?.find((item) => item.triggerId === "interior.npc-moreyield")?.actorSprite?.anims.currentFrame?.index ?? 0,
          frameCount: this.interactionObjects?.find((item) => item.triggerId === "interior.npc-moreyield")?.actorSprite?.anims.currentAnim?.frames?.length || 1,
          fps: this.interactionObjects?.find((item) => item.triggerId === "interior.npc-moreyield")?.actorSprite?.anims.currentAnim?.frameRate || 1,
          speed: npcState?.speed || NPC_MOVE_SPEED,
          route: {
            ...NPC_PATROL_BOUNDS,
            mode: npcState?.routeMode || "roaming",
            stops: [...NPC_PATROL_STOPS],
            targetX: npcState?.targetX ?? null,
            destinationType: npcState?.destinationType ?? null,
            completedStops: npcState?.completedStops ?? 0,
            completedTours: npcState?.completedTours ?? 0
          }
        }
      },
      autoStep: {
        maxHeight: AUTO_STEP_HEIGHT,
        count: this.autoStepCount,
        last: this.lastAutoStep
      },
      interactions: {
        blocked: this.interactionBlocked,
        simulationPaused: this.physics.world.isPaused,
        nearbyTriggerId: this.nearbyInteraction?.triggerId || null,
        distancePx: this.nearbyInteraction?.distance ?? null,
        objects: (this.interactionObjects || []).map(({ triggerId, label, kind, x, y }) => ({
          triggerId, label, kind, x, y
        }))
      }
    };
  }

  updateHud() {
    const feet = this.getFeet();
    if (this.ui.positionState) {
      this.ui.positionState.textContent = `feet: ${Math.round(feet.x)}, ${Math.round(feet.y)} · ${this.lifeState}`;
    }
    this.publishRuntime?.(this.runtime, this.getRuntimeSnapshot());
  }
}

export function mountPhaserCore(host, options = {}) {
  if (!(host instanceof Element)) throw new TypeError("mountPhaserCore requires a DOM Element host");
  if (host.__phaserCoreMount) return host.__phaserCoreMount;

  let destroyed = false;
  let readySettled = false;
  let activeRuntime = null;
  let activeScene = null;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = (value) => {
      if (readySettled) return;
      readySettled = true;
      resolve(value);
    };
    rejectReady = (error) => {
      if (readySettled) return;
      readySettled = true;
      reject(error);
    };
  });
  const publishRuntime = options.publishGlobals === false
    ? (runtime) => { activeRuntime = runtime; }
    : (runtime, snapshot) => {
        activeRuntime = runtime;
        if (runtime) {
          window.phaserCoreRuntime = runtime;
          window.phaserCoreDebug = runtime;
        }
        if (snapshot) window.__phaserCoreState = snapshot;
      };
  const Scene = class extends CoreScene {
    constructor() {
      super({
        ui: options.ui,
        publishRuntime,
        onReady: (runtime, scene) => {
          activeScene = scene;
          if (!destroyed) resolveReady(runtime);
        },
        onFailure: rejectReady,
        onInteraction: options.onInteraction,
        onInteractionStateChange: options.onInteractionStateChange,
        onLifeStateChange: options.onLifeStateChange,
        onSound: options.onSound
      });
    }
  };
  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent: host,
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    backgroundColor: "#202a28",
    antialias: false,
    roundPixels: false,
    banner: false,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: {
      default: "arcade",
      arcade: { gravity: { y: 2200 }, fps: 120, fixedStep: true, debug: false }
    },
    scene: Scene,
    callbacks: {
      postBoot: () => {
        if (destroyed) rejectReady(new Error("Phaser mount was destroyed before it became ready"));
      }
    }
  });

  const mount = {
    game,
    ready,
    get runtime() {
      return activeRuntime;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      rejectReady(new Error("Phaser mount was destroyed before it became ready"));
      activeScene?.disposeLifecycle();
      game.destroy(true);
      host.replaceChildren();
      if (window.__phaserCoreGame === game) delete window.__phaserCoreGame;
      if (window.phaserCoreRuntime === activeRuntime) delete window.phaserCoreRuntime;
      if (window.phaserCoreDebug === activeRuntime) delete window.phaserCoreDebug;
      if (window.__phaserCoreScene?.game === game) delete window.__phaserCoreScene;
      if (window.__phaserCoreState && !window.phaserCoreRuntime) delete window.__phaserCoreState;
      activeScene = null;
      delete host.__phaserCoreMount;
    }
  };
  host.__phaserCoreMount = mount;
  if (options.publishGlobals !== false) window.__phaserCoreGame = game;
  return mount;
}

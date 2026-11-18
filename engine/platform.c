#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <emscripten.h>

#include "doomgeneric.h"
#include "doomstat.h"
#include "d_player.h"
#include "p_local.h"

#define KEY_QUEUE_SIZE 64

static unsigned short key_queue[KEY_QUEUE_SIZE];
static unsigned int key_read = 0;
static unsigned int key_write = 0;
static unsigned int frame_count = 0;

void DG_Init(void) {}

void DG_DrawFrame(void) { frame_count++; }

// Blocking would freeze the page, and the engine polls the clock while it waits.
void DG_SleepMs(uint32_t ms) { (void)ms; }

uint32_t DG_GetTicksMs(void) { return (uint32_t)emscripten_get_now(); }

int DG_GetKey(int *pressed, unsigned char *key) {
  if (key_read == key_write) return 0;
  unsigned short data = key_queue[key_read];
  key_read = (key_read + 1) % KEY_QUEUE_SIZE;
  *pressed = data >> 8;
  *key = data & 0xff;
  return 1;
}

void DG_SetWindowTitle(const char *title) { (void)title; }

EMSCRIPTEN_KEEPALIVE void wadsmith_key(int pressed, int key) {
  unsigned int next = (key_write + 1) % KEY_QUEUE_SIZE;
  if (next == key_read) return;
  key_queue[key_write] = (unsigned short)((pressed << 8) | (key & 0xff));
  key_write = next;
}

EMSCRIPTEN_KEEPALIVE void wadsmith_tick(void) { doomgeneric_Tick(); }

EMSCRIPTEN_KEEPALIVE uint32_t *wadsmith_screen(void) { return DG_ScreenBuffer; }

EMSCRIPTEN_KEEPALIVE unsigned int wadsmith_frames(void) { return frame_count; }

EMSCRIPTEN_KEEPALIVE int wadsmith_game_state(void) { return gamestate; }

EMSCRIPTEN_KEEPALIVE int wadsmith_health(void) {
  return players[consoleplayer].health;
}

EMSCRIPTEN_KEEPALIVE int wadsmith_kills(void) {
  return players[consoleplayer].killcount;
}

EMSCRIPTEN_KEEPALIVE int wadsmith_total_kills(void) { return totalkills; }

EMSCRIPTEN_KEEPALIVE int wadsmith_player_x(void) {
  return players[consoleplayer].mo ? players[consoleplayer].mo->x >> 16 : 0;
}

EMSCRIPTEN_KEEPALIVE int wadsmith_player_y(void) {
  return players[consoleplayer].mo ? players[consoleplayer].mo->y >> 16 : 0;
}

// The engine keeps argv for its whole life, but callMain frees it on return.
int main(int argc, char **argv) {
  char **kept = malloc(sizeof(char *) * (argc + 1));
  for (int i = 0; i < argc; i++) kept[i] = strdup(argv[i]);
  kept[argc] = NULL;
  doomgeneric_Create(argc, kept);
  return 0;
}

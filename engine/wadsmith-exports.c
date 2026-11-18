#include <emscripten.h>
#include <SDL_mixer.h>

#include "r_state.h"
#include "s_sound.h"

extern int sfxVolume;
extern int musicVolume;
extern int wadsmith_output_muted;

EMSCRIPTEN_KEEPALIVE int wadsmith_game_state(void) { return gamestate; }

EMSCRIPTEN_KEEPALIVE int wadsmith_game_tic(void) { return gametic; }

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

EMSCRIPTEN_KEEPALIVE int wadsmith_sector_ceiling(int index) {
  return index >= 0 && index < numsectors
             ? sectors[index].ceilingheight >> 16
             : 0;
}

EMSCRIPTEN_KEEPALIVE void wadsmith_set_volume(int volume) {
  sfxVolume = volume;
  musicVolume = volume;
  S_SetSfxVolume(volume * 8);
  S_SetMusicVolume(volume * 8);
}

EMSCRIPTEN_KEEPALIVE void wadsmith_set_muted(int muted) {
  wadsmith_output_muted = muted;
}

EMSCRIPTEN_KEEPALIVE void wadsmith_stop(void) {
  emscripten_cancel_main_loop();
  Mix_CloseAudio();
}

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.services.nfl.dataset_builder import NflDatasetPaths, build_nfl_datasets  # noqa: E402
from app.services.nfl.model_trainer import train_nfl_game_model, train_nfl_player_models  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Build leakage-safe NFL team/player datasets and train separate models.")
    parser.add_argument("--team-games", type=Path, required=True, help="Normalized one-row-per-team-game CSV")
    parser.add_argument("--player-games", type=Path, required=True, help="Normalized one-row-per-player-game CSV")
    parser.add_argument("--output-dir", type=Path, default=BACKEND_ROOT / "data" / "processed")
    parser.add_argument("--model-dir", type=Path, default=BACKEND_ROOT / "models" / "nfl")
    parser.add_argument("--start-season", type=int, default=2011, help="First complete training season (default: 2011)")
    parser.add_argument("--end-season", type=int, default=2025, help="Latest complete season and chronological holdout (default: 2025)")
    args = parser.parse_args()
    game_path = args.output_dir / "nfl_games.csv"
    player_path = args.output_dir / "nfl_players.csv"
    games, players = build_nfl_datasets(
        NflDatasetPaths(args.team_games, args.player_games, game_path, player_path),
        start_season=args.start_season,
        end_season=args.end_season,
    )
    print(f"validated {args.end_season - args.start_season + 1} complete NFL seasons ({args.start_season}-{args.end_season})")
    print(f"wrote {len(games):,} NFL game rows to {game_path}")
    print(f"wrote {len(players):,} NFL player rows to {player_path}")
    print(train_nfl_game_model(game_path, args.model_dir))
    print(train_nfl_player_models(player_path, args.model_dir))


if __name__ == "__main__":
    main()

{
  description = "devsesh - Centralized dev session management and monitoring";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            go
            sqlite
            nodejs_22
            chromium
            playwright
            xvfb
            tmux
          ];

          shellHook = ''
            export CGO_ENABLED=0
          '';
        };
      });
}
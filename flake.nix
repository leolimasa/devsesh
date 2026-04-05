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
        go-version = "1.23";
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            go
            gopls
            gotools
            sqlite
            golangci-lint
            nodejs_22
          ];

          shellHook = ''
            export CGO_ENABLED=0
          '';
        };

        packages.default = pkgs.buildGoModule {
          pname = "devsesh";
          version = "0.1.0";

          src = ./.;

          vendorHash = null;

          subPackages = [ "." ];

          ldflags = [ "-s" "-w" ];

          meta = with pkgs.lib; {
            description = "Centralized dev session management and monitoring";
            license = licenses.mit;
          };
        };
      }
    );
}

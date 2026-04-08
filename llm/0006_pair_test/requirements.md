# Goal

To implement integration tests for pairing to the server

## Requirements

* Create a new pairing integration test that [req.djbmrd]
	* starts a server and registers a user [req.bd6pjg]
	* runs `devsesh login http://localhost:8080` to start pairing [req.8k6iv7]
	* reads the pairing code from the above output, and then types it in the web interface [req.zy2aio]
	* checks that the command line pairing completed and that there is a JWT file created [req.itzuip]
	* correct any bugs (with either the server or the frontend) if necessary [req.s648jn]

## Implementation notes

* Read the `README.md` file to understand the overall project scope [req.nq61vy]
* Read the markdown files in `doc/` file to understand the project architecture [req.3ymrap]
* Check the `integration_tests` folder for examples on how to write integration tests [req.5h39ar]
* Use existing functionality in `integration_tests` to start up the server, register, and authenticate [req.4afsee]

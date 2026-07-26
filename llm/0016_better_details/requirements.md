Objective: refactor the DESKTOP details panel to better show important statuses and other sessions.

* The MOBILE version of the panel stays the same [req.grjjp4]
* Remove the "Details" header. Replace it with the session name. [req.k2lrvl]
* Display the status right below it. No need for a "status" label.  [req.rzu77v]
* Option to switch between two tabs: sessions and details [req.5xxuhs]

## Details tab

* Show all the information as it is in the current details pane [req.p4qdil]

## Sessions tab

* List all devsesh sessions [req.se7ytg]
* For each session display: the session index on the list (starting at 1), a green or gray indicator representing activity, the session name, and, below all that in a small font, the current session status [req.7e3kbe]
* Clicking on a session will immediately load the session details URL for that session [req.her0nt]
* All the websocket events should still update data normally (including for all listed sessions) [req.7wil29]

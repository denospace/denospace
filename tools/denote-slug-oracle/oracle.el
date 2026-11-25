;;; oracle.el --- probe denote.el as a black box and record its output.
;; Calls only denote's public sluggification entry point. Reads nothing of its
;; implementation; records input/output pairs so the behaviour can be specified
;; without reference to the source.
(require 'denote)
(defun unescape (s)
  (replace-regexp-in-string
   "\\\\t" "\t"
   (replace-regexp-in-string "\\\\n" "\n" s)))
(with-temp-buffer
  (insert-file-contents "probes.tsv")
  (let ((out (find-file-noselect "oracle-out.tsv")))
    (goto-char (point-min))
    (while (not (eobp))
      (let* ((line (buffer-substring-no-properties (line-beginning-position) (line-end-position)))
             (tab (string-match "\t" line)))
        (when tab
          (let* ((comp (intern (substring line 0 tab)))
                 (input (unescape (substring line (1+ tab))))
                 (result (denote-sluggify-and-apply-rules comp input)))
            (with-current-buffer out
              (insert (format "%s\t%s\t%s\n" comp
                              (replace-regexp-in-string "\t" "\\\\t" input)
                              (replace-regexp-in-string "\t" "\\\\t" result)))))))
      (forward-line 1))
    (with-current-buffer out (write-file "oracle-out.tsv"))))

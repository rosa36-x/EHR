# Summary (mean ± std over seeds)

profile=legacy  seeds=1-10  days=90  severity=1.0  split=0.6/0.2/0.2  exclude_type=None clean_train=False p1_filtered_train=False p1_pct=val-selected select_pct=True

Tier status: P1 (the ensemble) is the detector. P2 and every LSTM-based row (LSTM only, DeepLog-style, P1 + P2) are an experimental sequence tier.

Thresholds, min-max ranges and LSTM stats fit on VAL; metrics on TEST only (rows with protocol random-10fold-all-windows pool all windows).

| protocol | method | n_pos | flags | tp | fp | precision | recall | f1 | flags_per_1k | precision_ceiling | ap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| temporal-test | P1 (ensemble, val-selected) | 15.700 ± 3.773 | 16.600 ± 4.006 | 11.200 ± 2.974 | 5.400 ± 4.033 | 0.696 ± 0.200 | 0.715 ± 0.105 | 0.689 ± 0.112 | 18.337 ± 4.391 | 0.858 ± 0.158 | 0.752 ± 0.082 |
| temporal-test | Votes>=4 (legacy rule) | 15.700 ± 3.773 | 21.700 ± 5.100 | 11.200 ± 3.293 | 10.500 ± 4.428 | 0.524 ± 0.133 | 0.710 ± 0.104 | 0.595 ± 0.106 | 23.970 ± 5.624 | 0.740 ± 0.186 | nan |
| temporal-test | IForest only (val-selected pct) | 15.700 ± 3.773 | 17.000 ± 5.696 | 9.600 ± 2.591 | 7.400 ± 5.317 | 0.614 ± 0.229 | 0.627 ± 0.164 | 0.585 ± 0.121 | 18.778 ± 6.292 | 0.814 ± 0.187 | 0.679 ± 0.105 |
| temporal-test | LSTM only (p99) | 15.700 ± 3.773 | 22.200 ± 4.962 | 5.800 ± 3.120 | 16.400 ± 3.471 | 0.255 ± 0.111 | 0.357 ± 0.163 | 0.293 ± 0.123 | 24.514 ± 5.405 | 0.714 ± 0.166 | 0.261 ± 0.113 |
| temporal-test | DeepLog-style (budget-matched g) | 15.700 ± 3.773 | 17.600 ± 6.851 | 3.300 ± 2.312 | 14.300 ± 6.816 | 0.227 ± 0.162 | 0.203 ± 0.117 | 0.196 ± 0.112 | 19.424 ± 7.487 | 0.779 ± 0.166 | 0.160 ± 0.109 |
| temporal-test | P1 + P2 (experimental sequence tier) | 15.700 ± 3.773 | 32.700 ± 5.982 | 11.800 ± 3.327 | 20.900 ± 5.363 | 0.366 ± 0.098 | 0.752 ± 0.129 | 0.485 ± 0.097 | 36.121 ± 6.570 | 0.494 ± 0.147 | nan |
| temporal-test | Supervised LR (train+val labels) | 15.700 ± 3.773 | 51.200 ± 11.849 | 12.100 ± 3.315 | 39.100 ± 11.464 | 0.244 ± 0.081 | 0.770 ± 0.102 | 0.363 ± 0.084 | 56.497 ± 12.795 | 0.322 ± 0.116 | 0.756 ± 0.074 |
| temporal-test | Supervised SVM (train+val labels) | 15.700 ± 3.773 | 44.700 ± 18.019 | 11.800 ± 2.936 | 32.900 ± 18.163 | 0.326 ± 0.244 | 0.756 ± 0.111 | 0.415 ± 0.153 | 49.246 ± 19.620 | 0.402 ± 0.231 | 0.373 ± 0.188 |
| random-10fold-all-windows | Supervised LR (10-fold CV, pooled) | 83.200 ± 1.317 | 282.000 ± 40.152 | 67.000 ± 2.944 | 215.000 ± 38.976 | 0.241 ± 0.029 | 0.805 ± 0.031 | 0.370 ± 0.034 | 60.050 ± 8.564 | 0.300 ± 0.042 | 0.780 ± 0.019 |
| random-10fold-all-windows | Supervised SVM (10-fold CV, pooled) | 83.200 ± 1.317 | 255.100 ± 77.861 | 65.700 ± 3.199 | 189.400 ± 76.650 | 0.279 ± 0.080 | 0.790 ± 0.040 | 0.405 ± 0.084 | 54.309 ± 16.556 | 0.356 ± 0.113 | 0.307 ± 0.085 |


# Dataset per seed

| seed | n_windows | n_pos_total | n_pos_train | n_pos_val | n_pos_test | n_test_windows | n_train_excluded | n_train_excluded_pos | p1_pct | lstm_epochs | g | seconds |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.0 | 4704.0 | 81.0 | 52.0 | 18.0 | 11.0 | 901.0 | 0.0 | 0.0 | 98.0 | 11.0 | 50.0 | 27.2 |
| 2.0 | 4678.0 | 83.0 | 54.0 | 17.0 | 12.0 | 893.0 | 0.0 | 0.0 | 98.0 | 9.0 | 50.0 | 20.8 |
| 3.0 | 4668.0 | 84.0 | 49.0 | 22.0 | 13.0 | 907.0 | 0.0 | 0.0 | 98.0 | 11.0 | 60.0 | 21.2 |
| 4.0 | 4670.0 | 84.0 | 46.0 | 14.0 | 24.0 | 892.0 | 0.0 | 0.0 | 99.0 | 10.0 | 60.0 | 21.3 |
| 5.0 | 4679.0 | 83.0 | 46.0 | 20.0 | 17.0 | 908.0 | 0.0 | 0.0 | 98.0 | 12.0 | 60.0 | 22.2 |
| 6.0 | 4724.0 | 81.0 | 44.0 | 19.0 | 18.0 | 923.0 | 0.0 | 0.0 | 98.0 | 8.0 | 50.0 | 19.6 |
| 7.0 | 4682.0 | 85.0 | 53.0 | 15.0 | 17.0 | 911.0 | 0.0 | 0.0 | 98.0 | 11.0 | 50.0 | 21.4 |
| 8.0 | 4727.0 | 84.0 | 49.0 | 19.0 | 16.0 | 913.0 | 0.0 | 0.0 | 98.0 | 9.0 | 50.0 | 20.1 |
| 9.0 | 4681.0 | 83.0 | 49.0 | 21.0 | 13.0 | 893.0 | 0.0 | 0.0 | 98.0 | 8.0 | 50.0 | 21.2 |
| 10.0 | 4749.0 | 84.0 | 47.0 | 21.0 | 16.0 | 912.0 | 0.0 | 0.0 | 98.0 | 11.0 | 50.0 | 23.2 |


# Threshold sweep (mean over seeds; P1 percentile fit on VAL)

| system | p1_percentile | flags | precision | recall | precision_ceiling | flags_per_1k |
|---|---|---|---|---|---|---|
| P1 | 90.0 | 90.0 | 0.144 | 0.805 | 0.179 | 99.478 |
| P1+P2 | 90.0 | 103.9 | 0.129 | 0.837 | 0.155 | 114.827 |
| P1 | 93.0 | 68.5 | 0.18 | 0.766 | 0.235 | 75.694 |
| P1+P2 | 93.0 | 82.9 | 0.154 | 0.798 | 0.194 | 91.596 |
| P1 | 95.0 | 56.2 | 0.226 | 0.76 | 0.303 | 62.179 |
| P1+P2 | 95.0 | 70.7 | 0.181 | 0.793 | 0.233 | 78.189 |
| P1 | 97.0 | 25.9 | 0.474 | 0.752 | 0.633 | 28.639 |
| P1+P2 | 97.0 | 40.9 | 0.304 | 0.785 | 0.392 | 45.205 |
| P1 | 98.0 | 18.1 | 0.648 | 0.715 | 0.835 | 20.019 |
| P1+P2 | 98.0 | 33.9 | 0.353 | 0.752 | 0.475 | 37.467 |
| P1 | 99.0 | 9.2 | 0.989 | 0.573 | 1.0 | 10.166 |
| P1+P2 | 99.0 | 27.1 | 0.39 | 0.67 | 0.59 | 29.938 |
| P1 | 99.5 | 4.1 | 1.0 | 0.262 | 1.0 | 4.526 |
| P1+P2 | 99.5 | 24.4 | 0.326 | 0.503 | 0.651 | 26.954 |


# Recall by anomaly type (test windows pooled over seeds)

| method | anomaly_type | n_pos | caught | recall |
|---|---|---|---|---|
| P1 (ensemble, val-selected) | bigram_violation | 25 | 2 | 0.08 |
| P1 (ensemble, val-selected) | order_composition | 26 | 4 | 0.154 |
| P1 (ensemble, val-selected) | untagged | 106 | 106 | 1.0 |
| LSTM only (p99) | bigram_violation | 25 | 5 | 0.2 |
| LSTM only (p99) | order_composition | 26 | 3 | 0.115 |
| LSTM only (p99) | untagged | 106 | 50 | 0.472 |
| DeepLog-style (budget-matched g) | bigram_violation | 25 | 1 | 0.04 |
| DeepLog-style (budget-matched g) | order_composition | 26 | 4 | 0.154 |
| DeepLog-style (budget-matched g) | untagged | 106 | 28 | 0.264 |
| P1 + P2 (experimental sequence tier) | bigram_violation | 25 | 6 | 0.24 |
| P1 + P2 (experimental sequence tier) | order_composition | 26 | 6 | 0.231 |
| P1 + P2 (experimental sequence tier) | untagged | 106 | 106 | 1.0 |
| Supervised LR (train+val labels) | bigram_violation | 25 | 4 | 0.16 |
| Supervised LR (train+val labels) | order_composition | 26 | 11 | 0.423 |
| Supervised LR (train+val labels) | untagged | 106 | 106 | 1.0 |

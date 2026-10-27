# Summary (mean ± std over seeds)

profile=v2  seeds=1-10  days=90  severity=1.0  split=0.6/0.2/0.2  exclude_type=None clean_train=True p1_filtered_train=False p1_pct=val-selected select_pct=True

Tier status: P1 (the ensemble) is the detector. P2 and every LSTM-based row (LSTM only, DeepLog-style, P1 + P2) are an experimental sequence tier.

Thresholds, min-max ranges and LSTM stats fit on VAL; metrics on TEST only (rows with protocol random-10fold-all-windows pool all windows).

| protocol | method | n_pos | flags | tp | fp | precision | recall | f1 | flags_per_1k | precision_ceiling | ap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| temporal-test | P1 (ensemble, val-selected) | 44.400 ± 5.835 | 43.700 ± 10.078 | 31.000 ± 6.633 | 12.700 ± 7.514 | 0.725 ± 0.136 | 0.695 ± 0.098 | 0.704 ± 0.093 | 51.671 ± 11.597 | 0.946 ± 0.081 | 0.714 ± 0.075 |
| temporal-test | Votes>=4 (legacy rule) | 44.400 ± 5.835 | 48.900 ± 8.306 | 29.200 ± 6.779 | 19.700 ± 4.218 | 0.595 ± 0.073 | 0.653 ± 0.090 | 0.621 ± 0.074 | 57.813 ± 9.180 | 0.905 ± 0.071 | nan |
| temporal-test | IForest only (val-selected pct) | 44.400 ± 5.835 | 44.500 ± 10.416 | 27.600 ± 6.132 | 16.900 ± 9.994 | 0.639 ± 0.142 | 0.618 ± 0.082 | 0.622 ± 0.098 | 52.623 ± 12.006 | 0.930 ± 0.117 | 0.645 ± 0.081 |
| temporal-test | LSTM only (p99) | 44.400 ± 5.835 | 28.600 ± 3.777 | 9.300 ± 4.111 | 19.300 ± 2.497 | 0.318 ± 0.105 | 0.205 ± 0.070 | 0.248 ± 0.083 | 33.833 ± 4.057 | 1.000 ± 0.000 | 0.295 ± 0.096 |
| temporal-test | DeepLog-style (budget-matched g) | 44.400 ± 5.835 | 40.200 ± 10.549 | 24.500 ± 7.059 | 15.700 ± 7.334 | 0.617 ± 0.117 | 0.545 ± 0.105 | 0.573 ± 0.092 | 47.518 ± 12.150 | 0.955 ± 0.073 | 0.626 ± 0.115 |
| temporal-test | P1 + P2 (experimental sequence tier) | 44.400 ± 5.835 | 61.600 ± 8.771 | 31.800 ± 6.546 | 29.800 ± 6.215 | 0.516 ± 0.073 | 0.713 ± 0.093 | 0.597 ± 0.073 | 72.891 ± 9.894 | 0.728 ± 0.102 | nan |
| temporal-test | Supervised LR (train+val labels) | 44.400 ± 5.835 | 70.800 ± 11.429 | 33.900 ± 7.094 | 36.900 ± 5.567 | 0.476 ± 0.043 | 0.760 ± 0.097 | 0.585 ± 0.057 | 83.701 ± 12.356 | 0.631 ± 0.055 | 0.749 ± 0.073 |
| temporal-test | Supervised SVM (train+val labels) | 44.400 ± 5.835 | 64.100 ± 17.458 | 33.600 ± 7.043 | 30.500 ± 14.042 | 0.541 ± 0.120 | 0.754 ± 0.102 | 0.620 ± 0.078 | 75.852 ± 20.512 | 0.723 ± 0.181 | 0.587 ± 0.118 |
| random-10fold-all-windows | Supervised LR (10-fold CV, pooled) | 243.200 ± 2.616 | 389.700 ± 12.266 | 190.400 ± 3.534 | 199.300 ± 11.576 | 0.489 ± 0.015 | 0.783 ± 0.009 | 0.602 ± 0.013 | 89.372 ± 1.980 | 0.625 ± 0.018 | 0.765 ± 0.020 |
| random-10fold-all-windows | Supervised SVM (10-fold CV, pooled) | 243.200 ± 2.616 | 361.400 ± 64.768 | 188.700 ± 5.599 | 172.700 ± 60.504 | 0.536 ± 0.091 | 0.776 ± 0.023 | 0.629 ± 0.056 | 82.943 ± 15.030 | 0.694 ± 0.131 | 0.597 ± 0.068 |


# Dataset per seed

| seed | n_windows | n_pos_total | n_pos_train | n_pos_val | n_pos_test | n_test_windows | n_train_excluded | n_train_excluded_pos | p1_pct | lstm_epochs | g | seconds |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.0 | 4404.0 | 245.0 | 149.0 | 48.0 | 48.0 | 857.0 | 0.0 | 0.0 | 95.0 | 9.0 | 50.0 | 25.4 |
| 2.0 | 4422.0 | 246.0 | 143.0 | 57.0 | 46.0 | 855.0 | 0.0 | 0.0 | 93.0 | 9.0 | 60.0 | 19.6 |
| 3.0 | 4227.0 | 239.0 | 152.0 | 54.0 | 33.0 | 814.0 | 0.0 | 0.0 | 95.0 | 8.0 | 115.0 | 18.5 |
| 4.0 | 4384.0 | 244.0 | 154.0 | 48.0 | 42.0 | 845.0 | 0.0 | 0.0 | 95.0 | 7.0 | 80.0 | 18.6 |
| 5.0 | 4373.0 | 245.0 | 157.0 | 47.0 | 41.0 | 850.0 | 0.0 | 0.0 | 93.0 | 8.0 | 60.0 | 19.1 |
| 6.0 | 4302.0 | 242.0 | 150.0 | 48.0 | 44.0 | 823.0 | 0.0 | 0.0 | 93.0 | 9.0 | 60.0 | 19.0 |
| 7.0 | 4302.0 | 242.0 | 158.0 | 40.0 | 44.0 | 836.0 | 0.0 | 0.0 | 95.0 | 11.0 | 60.0 | 20.5 |
| 8.0 | 4438.0 | 242.0 | 138.0 | 48.0 | 56.0 | 875.0 | 0.0 | 0.0 | 95.0 | 11.0 | 100.0 | 24.0 |
| 9.0 | 4378.0 | 240.0 | 139.0 | 54.0 | 47.0 | 845.0 | 0.0 | 0.0 | 95.0 | 8.0 | 80.0 | 18.9 |
| 10.0 | 4369.0 | 247.0 | 154.0 | 50.0 | 43.0 | 845.0 | 0.0 | 0.0 | 95.0 | 8.0 | 60.0 | 19.7 |


# Threshold sweep (mean over seeds; P1 percentile fit on VAL)

| system | p1_percentile | flags | precision | recall | precision_ceiling | flags_per_1k |
|---|---|---|---|---|---|---|
| P1 | 90.0 | 81.7 | 0.411 | 0.749 | 0.552 | 96.75 |
| P1+P2 | 90.0 | 96.6 | 0.353 | 0.765 | 0.463 | 114.394 |
| P1 | 93.0 | 53.8 | 0.583 | 0.706 | 0.833 | 63.64 |
| P1+P2 | 93.0 | 70.8 | 0.451 | 0.722 | 0.628 | 83.797 |
| P1 | 95.0 | 38.9 | 0.784 | 0.68 | 0.983 | 45.989 |
| P1+P2 | 95.0 | 57.8 | 0.536 | 0.7 | 0.772 | 68.39 |
| P1 | 97.0 | 22.9 | 0.942 | 0.479 | 1.0 | 27.044 |
| P1+P2 | 97.0 | 44.0 | 0.529 | 0.527 | 0.963 | 52.047 |
| P1 | 98.0 | 18.1 | 0.961 | 0.386 | 1.0 | 21.357 |
| P1+P2 | 98.0 | 39.6 | 0.486 | 0.437 | 0.987 | 46.838 |
| P1 | 99.0 | 10.8 | 0.947 | 0.227 | 1.0 | 12.736 |
| P1+P2 | 99.0 | 33.8 | 0.406 | 0.312 | 1.0 | 39.984 |
| P1 | 99.5 | 5.6 | 0.947 | 0.118 | 1.0 | 6.604 |
| P1+P2 | 99.5 | 31.6 | 0.371 | 0.268 | 1.0 | 37.375 |


# Recall by anomaly type (test windows pooled over seeds)

| method | anomaly_type | n_pos | caught | recall |
|---|---|---|---|---|
| P1 (ensemble, val-selected) | bigram_violation | 66 | 2 | 0.03 |
| P1 (ensemble, val-selected) | broad_access | 64 | 64 | 1.0 |
| P1 (ensemble, val-selected) | consent_probe | 72 | 72 | 1.0 |
| P1 (ensemble, val-selected) | cross_org_denied | 61 | 61 | 1.0 |
| P1 (ensemble, val-selected) | dispense_without_read | 56 | 44 | 0.786 |
| P1 (ensemble, val-selected) | off_hours_burst | 63 | 61 | 0.968 |
| P1 (ensemble, val-selected) | order_composition | 62 | 6 | 0.097 |
| LSTM only (p99) | bigram_violation | 66 | 4 | 0.061 |
| LSTM only (p99) | broad_access | 64 | 4 | 0.062 |
| LSTM only (p99) | consent_probe | 72 | 55 | 0.764 |
| LSTM only (p99) | cross_org_denied | 61 | 16 | 0.262 |
| LSTM only (p99) | dispense_without_read | 56 | 3 | 0.054 |
| LSTM only (p99) | off_hours_burst | 63 | 5 | 0.079 |
| LSTM only (p99) | order_composition | 62 | 6 | 0.097 |
| DeepLog-style (budget-matched g) | bigram_violation | 66 | 43 | 0.652 |
| DeepLog-style (budget-matched g) | broad_access | 64 | 8 | 0.125 |
| DeepLog-style (budget-matched g) | consent_probe | 72 | 72 | 1.0 |
| DeepLog-style (budget-matched g) | cross_org_denied | 61 | 56 | 0.918 |
| DeepLog-style (budget-matched g) | dispense_without_read | 56 | 46 | 0.821 |
| DeepLog-style (budget-matched g) | off_hours_burst | 63 | 18 | 0.286 |
| DeepLog-style (budget-matched g) | order_composition | 62 | 2 | 0.032 |
| P1 + P2 (experimental sequence tier) | bigram_violation | 66 | 6 | 0.091 |
| P1 + P2 (experimental sequence tier) | broad_access | 64 | 64 | 1.0 |
| P1 + P2 (experimental sequence tier) | consent_probe | 72 | 72 | 1.0 |
| P1 + P2 (experimental sequence tier) | cross_org_denied | 61 | 61 | 1.0 |
| P1 + P2 (experimental sequence tier) | dispense_without_read | 56 | 44 | 0.786 |
| P1 + P2 (experimental sequence tier) | off_hours_burst | 63 | 61 | 0.968 |
| P1 + P2 (experimental sequence tier) | order_composition | 62 | 10 | 0.161 |
| Supervised LR (train+val labels) | bigram_violation | 66 | 9 | 0.136 |
| Supervised LR (train+val labels) | broad_access | 64 | 64 | 1.0 |
| Supervised LR (train+val labels) | consent_probe | 72 | 72 | 1.0 |
| Supervised LR (train+val labels) | cross_org_denied | 61 | 61 | 1.0 |
| Supervised LR (train+val labels) | dispense_without_read | 56 | 56 | 1.0 |
| Supervised LR (train+val labels) | off_hours_burst | 63 | 61 | 0.968 |
| Supervised LR (train+val labels) | order_composition | 62 | 16 | 0.258 |

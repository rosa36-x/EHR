# Summary (mean ± std over seeds)

profile=v2  seeds=1-10  days=90  severity=1.0  split=0.6/0.2/0.2  exclude_type=None clean_train=False p1_filtered_train=True p1_pct=val-selected select_pct=True

Tier status: P1 (the ensemble) is the detector. P2 and every LSTM-based row (LSTM only, DeepLog-style, P1 + P2) are an experimental sequence tier.

Thresholds, min-max ranges and LSTM stats fit on VAL; metrics on TEST only (rows with protocol random-10fold-all-windows pool all windows).

| protocol | method | n_pos | flags | tp | fp | precision | recall | f1 | flags_per_1k | precision_ceiling | ap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| temporal-test | P1 (ensemble, val-selected) | 44.400 ± 5.835 | 39.000 ± 9.603 | 31.000 ± 6.831 | 8.000 ± 4.110 | 0.802 ± 0.070 | 0.695 ± 0.103 | 0.739 ± 0.067 | 46.087 ± 10.940 | 0.981 ± 0.053 | 0.714 ± 0.086 |
| temporal-test | Votes>=4 (legacy rule) | 44.400 ± 5.835 | 35.500 ± 8.885 | 29.700 ± 6.800 | 5.800 ± 2.440 | 0.841 ± 0.041 | 0.665 ± 0.100 | 0.738 ± 0.065 | 41.932 ± 9.932 | 1.000 ± 0.000 | nan |
| temporal-test | IForest only (val-selected pct) | 44.400 ± 5.835 | 38.700 ± 9.214 | 30.000 ± 6.583 | 8.700 ± 4.620 | 0.781 ± 0.082 | 0.673 ± 0.102 | 0.717 ± 0.065 | 45.774 ± 10.635 | 0.979 ± 0.068 | 0.704 ± 0.088 |
| temporal-test | LSTM only (p99) | 44.400 ± 5.835 | 29.500 ± 4.743 | 10.200 ± 3.190 | 19.300 ± 3.773 | 0.345 ± 0.096 | 0.226 ± 0.050 | 0.273 ± 0.064 | 34.889 ± 5.225 | 1.000 ± 0.000 | 0.301 ± 0.098 |
| temporal-test | DeepLog-style (budget-matched g) | 44.400 ± 5.835 | 41.400 ± 8.631 | 25.800 ± 7.421 | 15.600 ± 7.230 | 0.626 ± 0.134 | 0.575 ± 0.124 | 0.596 ± 0.122 | 48.987 ± 10.156 | 0.969 ± 0.064 | 0.569 ± 0.134 |
| temporal-test | P1 + P2 (experimental sequence tier) | 44.400 ± 5.835 | 57.900 ± 10.949 | 31.300 ± 6.617 | 26.600 ± 6.753 | 0.542 ± 0.071 | 0.702 ± 0.097 | 0.609 ± 0.071 | 68.463 ± 12.325 | 0.778 ± 0.095 | nan |
| temporal-test | Supervised LR (train+val labels) | 44.400 ± 5.835 | 70.800 ± 11.429 | 33.900 ± 7.094 | 36.900 ± 5.567 | 0.476 ± 0.043 | 0.760 ± 0.097 | 0.585 ± 0.057 | 83.701 ± 12.356 | 0.631 ± 0.055 | 0.749 ± 0.073 |
| temporal-test | Supervised SVM (train+val labels) | 44.400 ± 5.835 | 64.100 ± 17.458 | 33.600 ± 7.043 | 30.500 ± 14.042 | 0.541 ± 0.120 | 0.754 ± 0.102 | 0.620 ± 0.078 | 75.852 ± 20.512 | 0.723 ± 0.181 | 0.587 ± 0.118 |
| random-10fold-all-windows | Supervised LR (10-fold CV, pooled) | 243.200 ± 2.616 | 389.700 ± 12.266 | 190.400 ± 3.534 | 199.300 ± 11.576 | 0.489 ± 0.015 | 0.783 ± 0.009 | 0.602 ± 0.013 | 89.372 ± 1.980 | 0.625 ± 0.018 | 0.765 ± 0.020 |
| random-10fold-all-windows | Supervised SVM (10-fold CV, pooled) | 243.200 ± 2.616 | 361.400 ± 64.768 | 188.700 ± 5.599 | 172.700 ± 60.504 | 0.536 ± 0.091 | 0.776 ± 0.023 | 0.629 ± 0.056 | 82.943 ± 15.030 | 0.694 ± 0.131 | 0.597 ± 0.068 |


# Dataset per seed

| seed | n_windows | n_pos_total | n_pos_train | n_pos_val | n_pos_test | n_test_windows | n_train_excluded | n_train_excluded_pos | p1_pct | lstm_epochs | g | seconds |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.0 | 4404.0 | 245.0 | 149.0 | 48.0 | 48.0 | 857.0 | 140.0 | 107.0 | 95.0 | 8.0 | 60.0 | 26.2 |
| 2.0 | 4422.0 | 246.0 | 143.0 | 57.0 | 46.0 | 855.0 | 111.0 | 99.0 | 95.0 | 9.0 | 60.0 | 20.1 |
| 3.0 | 4227.0 | 239.0 | 152.0 | 54.0 | 33.0 | 814.0 | 124.0 | 107.0 | 95.0 | 8.0 | 130.0 | 18.4 |
| 4.0 | 4384.0 | 244.0 | 154.0 | 48.0 | 42.0 | 845.0 | 148.0 | 119.0 | 95.0 | 7.0 | 80.0 | 18.6 |
| 5.0 | 4373.0 | 245.0 | 157.0 | 47.0 | 41.0 | 850.0 | 135.0 | 112.0 | 95.0 | 8.0 | 60.0 | 19.4 |
| 6.0 | 4302.0 | 242.0 | 150.0 | 48.0 | 44.0 | 823.0 | 135.0 | 111.0 | 95.0 | 16.0 | 60.0 | 22.1 |
| 7.0 | 4302.0 | 242.0 | 158.0 | 40.0 | 44.0 | 836.0 | 160.0 | 111.0 | 95.0 | 10.0 | 60.0 | 19.2 |
| 8.0 | 4438.0 | 242.0 | 138.0 | 48.0 | 56.0 | 875.0 | 106.0 | 92.0 | 95.0 | 7.0 | 80.0 | 19.2 |
| 9.0 | 4378.0 | 240.0 | 139.0 | 54.0 | 47.0 | 845.0 | 126.0 | 99.0 | 95.0 | 8.0 | 80.0 | 18.9 |
| 10.0 | 4369.0 | 247.0 | 154.0 | 50.0 | 43.0 | 845.0 | 121.0 | 106.0 | 95.0 | 9.0 | 50.0 | 20.1 |


# Threshold sweep (mean over seeds; P1 percentile fit on VAL)

| system | p1_percentile | flags | precision | recall | precision_ceiling | flags_per_1k |
|---|---|---|---|---|---|---|
| P1 | 90.0 | 85.9 | 0.388 | 0.742 | 0.525 | 101.649 |
| P1+P2 | 90.0 | 101.1 | 0.33 | 0.747 | 0.442 | 119.649 |
| P1 | 93.0 | 54.6 | 0.59 | 0.726 | 0.822 | 64.582 |
| P1+P2 | 93.0 | 70.8 | 0.458 | 0.73 | 0.63 | 83.768 |
| P1 | 95.0 | 39.0 | 0.802 | 0.695 | 0.981 | 46.087 |
| P1+P2 | 95.0 | 57.9 | 0.542 | 0.702 | 0.778 | 68.463 |
| P1 | 97.0 | 23.3 | 0.917 | 0.477 | 1.0 | 27.538 |
| P1+P2 | 97.0 | 45.8 | 0.535 | 0.551 | 0.939 | 54.164 |
| P1 | 98.0 | 16.5 | 0.936 | 0.346 | 1.0 | 19.513 |
| P1+P2 | 98.0 | 41.8 | 0.512 | 0.483 | 0.969 | 49.444 |
| P1 | 99.0 | 9.0 | 0.943 | 0.19 | 1.0 | 10.625 |
| P1+P2 | 99.0 | 36.0 | 0.449 | 0.364 | 0.994 | 42.569 |
| P1 | 99.5 | 5.2 | 0.952 | 0.108 | 1.0 | 6.121 |
| P1+P2 | 99.5 | 33.1 | 0.404 | 0.3 | 1.0 | 39.13 |


# Recall by anomaly type (test windows pooled over seeds)

| method | anomaly_type | n_pos | caught | recall |
|---|---|---|---|---|
| P1 (ensemble, val-selected) | bigram_violation | 66 | 2 | 0.03 |
| P1 (ensemble, val-selected) | broad_access | 64 | 63 | 0.984 |
| P1 (ensemble, val-selected) | consent_probe | 72 | 72 | 1.0 |
| P1 (ensemble, val-selected) | cross_org_denied | 61 | 59 | 0.967 |
| P1 (ensemble, val-selected) | dispense_without_read | 56 | 49 | 0.875 |
| P1 (ensemble, val-selected) | off_hours_burst | 63 | 60 | 0.952 |
| P1 (ensemble, val-selected) | order_composition | 62 | 5 | 0.081 |
| LSTM only (p99) | bigram_violation | 66 | 0 | 0.0 |
| LSTM only (p99) | broad_access | 64 | 18 | 0.281 |
| LSTM only (p99) | consent_probe | 72 | 57 | 0.792 |
| LSTM only (p99) | cross_org_denied | 61 | 12 | 0.197 |
| LSTM only (p99) | dispense_without_read | 56 | 4 | 0.071 |
| LSTM only (p99) | off_hours_burst | 63 | 7 | 0.111 |
| LSTM only (p99) | order_composition | 62 | 4 | 0.065 |
| DeepLog-style (budget-matched g) | bigram_violation | 66 | 4 | 0.061 |
| DeepLog-style (budget-matched g) | broad_access | 64 | 56 | 0.875 |
| DeepLog-style (budget-matched g) | consent_probe | 72 | 72 | 1.0 |
| DeepLog-style (budget-matched g) | cross_org_denied | 61 | 55 | 0.902 |
| DeepLog-style (budget-matched g) | dispense_without_read | 56 | 24 | 0.429 |
| DeepLog-style (budget-matched g) | off_hours_burst | 63 | 41 | 0.651 |
| DeepLog-style (budget-matched g) | order_composition | 62 | 6 | 0.097 |
| P1 + P2 (experimental sequence tier) | bigram_violation | 66 | 2 | 0.03 |
| P1 + P2 (experimental sequence tier) | broad_access | 64 | 63 | 0.984 |
| P1 + P2 (experimental sequence tier) | consent_probe | 72 | 72 | 1.0 |
| P1 + P2 (experimental sequence tier) | cross_org_denied | 61 | 59 | 0.967 |
| P1 + P2 (experimental sequence tier) | dispense_without_read | 56 | 49 | 0.875 |
| P1 + P2 (experimental sequence tier) | off_hours_burst | 63 | 60 | 0.952 |
| P1 + P2 (experimental sequence tier) | order_composition | 62 | 8 | 0.129 |
| Supervised LR (train+val labels) | bigram_violation | 66 | 9 | 0.136 |
| Supervised LR (train+val labels) | broad_access | 64 | 64 | 1.0 |
| Supervised LR (train+val labels) | consent_probe | 72 | 72 | 1.0 |
| Supervised LR (train+val labels) | cross_org_denied | 61 | 61 | 1.0 |
| Supervised LR (train+val labels) | dispense_without_read | 56 | 56 | 1.0 |
| Supervised LR (train+val labels) | off_hours_burst | 63 | 61 | 0.968 |
| Supervised LR (train+val labels) | order_composition | 62 | 16 | 0.258 |

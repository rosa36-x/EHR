# Summary (mean ± std over seeds)

profile=v2  seeds=1-10  days=90  severity=1.0  split=0.6/0.2/0.2  exclude_type=None clean_train=False p1_filtered_train=True

Thresholds, min-max ranges and LSTM stats fit on VAL; metrics on TEST only (rows with protocol random-10fold-all-windows pool all windows).

| protocol | method | n_pos | flags | tp | fp | precision | recall | f1 | flags_per_1k | precision_ceiling | ap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| temporal-test | P1 (ensemble p97) | 44.400 ± 5.835 | 23.300 ± 7.846 | 21.300 ± 6.767 | 2.000 ± 1.826 | 0.917 ± 0.066 | 0.477 ± 0.129 | 0.618 ± 0.103 | 27.538 ± 9.136 | 1.000 ± 0.000 | 0.714 ± 0.086 |
| temporal-test | Votes>=4 (legacy rule) | 44.400 ± 5.835 | 35.500 ± 8.885 | 29.700 ± 6.800 | 5.800 ± 2.440 | 0.841 ± 0.041 | 0.665 ± 0.100 | 0.738 ± 0.065 | 41.932 ± 9.932 | 1.000 ± 0.000 | nan |
| temporal-test | IForest only (p97) | 44.400 ± 5.835 | 24.300 ± 8.564 | 22.200 ± 7.480 | 2.100 ± 2.079 | 0.916 ± 0.062 | 0.493 ± 0.134 | 0.631 ± 0.106 | 28.697 ± 9.948 | 1.000 ± 0.000 | 0.704 ± 0.088 |
| temporal-test | LSTM only (p99) | 44.400 ± 5.835 | 26.700 ± 7.056 | 6.900 ± 3.635 | 19.800 ± 5.884 | 0.259 ± 0.110 | 0.151 ± 0.063 | 0.188 ± 0.078 | 31.572 ± 8.037 | 1.000 ± 0.000 | 0.185 ± 0.076 |
| temporal-test | DeepLog-style (budget-matched g) | 44.400 ± 5.835 | 22.700 ± 7.587 | 6.500 ± 1.780 | 16.200 ± 8.270 | 0.325 ± 0.145 | 0.146 ± 0.036 | 0.195 ± 0.055 | 27.017 ± 9.447 | 1.000 ± 0.000 | 0.179 ± 0.062 |
| temporal-test | Deployed P1+P2 | 44.400 ± 5.835 | 45.800 ± 8.257 | 24.200 ± 7.269 | 21.600 ± 5.190 | 0.524 ± 0.104 | 0.540 ± 0.126 | 0.529 ± 0.108 | 54.161 ± 9.106 | 0.928 ± 0.087 | nan |
| temporal-test | Supervised LR (train+val labels) | 44.400 ± 5.835 | 70.800 ± 11.429 | 33.900 ± 7.094 | 36.900 ± 5.567 | 0.476 ± 0.043 | 0.760 ± 0.097 | 0.585 ± 0.057 | 83.701 ± 12.356 | 0.631 ± 0.055 | 0.749 ± 0.073 |
| temporal-test | Supervised SVM (train+val labels) | 44.400 ± 5.835 | 64.100 ± 17.458 | 33.600 ± 7.043 | 30.500 ± 14.042 | 0.541 ± 0.120 | 0.754 ± 0.102 | 0.620 ± 0.078 | 75.852 ± 20.512 | 0.723 ± 0.181 | 0.587 ± 0.118 |
| random-10fold-all-windows | Supervised LR (10-fold CV, pooled) | 243.200 ± 2.616 | 389.700 ± 12.266 | 190.400 ± 3.534 | 199.300 ± 11.576 | 0.489 ± 0.015 | 0.783 ± 0.009 | 0.602 ± 0.013 | 89.372 ± 1.980 | 0.625 ± 0.018 | 0.765 ± 0.020 |
| random-10fold-all-windows | Supervised SVM (10-fold CV, pooled) | 243.200 ± 2.616 | 361.400 ± 64.768 | 188.700 ± 5.599 | 172.700 ± 60.504 | 0.536 ± 0.091 | 0.776 ± 0.023 | 0.629 ± 0.056 | 82.943 ± 15.030 | 0.694 ± 0.131 | 0.597 ± 0.068 |


# Dataset per seed

| seed | n_windows | n_pos_total | n_pos_train | n_pos_val | n_pos_test | n_test_windows | n_train_excluded | n_train_excluded_pos | lstm_epochs | g | seconds |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.0 | 4404.0 | 245.0 | 149.0 | 48.0 | 48.0 | 857.0 | 84.0 | 79.0 | 10.0 | 50.0 | 35.3 |
| 2.0 | 4422.0 | 246.0 | 143.0 | 57.0 | 46.0 | 855.0 | 53.0 | 52.0 | 11.0 | 60.0 | 27.5 |
| 3.0 | 4227.0 | 239.0 | 152.0 | 54.0 | 33.0 | 814.0 | 72.0 | 65.0 | 8.0 | 50.0 | 21.1 |
| 4.0 | 4384.0 | 244.0 | 154.0 | 48.0 | 42.0 | 845.0 | 66.0 | 58.0 | 14.0 | 60.0 | 23.7 |
| 5.0 | 4373.0 | 245.0 | 157.0 | 47.0 | 41.0 | 850.0 | 69.0 | 65.0 | 8.0 | 60.0 | 21.6 |
| 6.0 | 4302.0 | 242.0 | 150.0 | 48.0 | 44.0 | 823.0 | 82.0 | 74.0 | 8.0 | 50.0 | 21.3 |
| 7.0 | 4302.0 | 242.0 | 158.0 | 40.0 | 44.0 | 836.0 | 91.0 | 78.0 | 9.0 | 50.0 | 22.8 |
| 8.0 | 4438.0 | 242.0 | 138.0 | 48.0 | 56.0 | 875.0 | 48.0 | 44.0 | 11.0 | 60.0 | 26.9 |
| 9.0 | 4378.0 | 240.0 | 139.0 | 54.0 | 47.0 | 845.0 | 61.0 | 56.0 | 10.0 | 60.0 | 21.3 |
| 10.0 | 4369.0 | 247.0 | 154.0 | 50.0 | 43.0 | 845.0 | 83.0 | 78.0 | 10.0 | 60.0 | 23.6 |


# Threshold sweep (mean over seeds; P1 percentile fit on VAL)

| system | p1_percentile | flags | precision | recall | precision_ceiling | flags_per_1k |
|---|---|---|---|---|---|---|
| P1 | 90.0 | 85.9 | 0.388 | 0.742 | 0.525 | 101.649 |
| P1+P2 | 90.0 | 102.5 | 0.325 | 0.746 | 0.437 | 121.271 |
| P1 | 93.0 | 54.6 | 0.59 | 0.726 | 0.822 | 64.582 |
| P1+P2 | 93.0 | 72.3 | 0.449 | 0.73 | 0.618 | 85.517 |
| P1 | 95.0 | 39.0 | 0.802 | 0.695 | 0.981 | 46.087 |
| P1+P2 | 95.0 | 58.5 | 0.531 | 0.699 | 0.765 | 69.173 |
| P1 | 97.0 | 23.3 | 0.917 | 0.477 | 1.0 | 27.538 |
| P1+P2 | 97.0 | 45.8 | 0.524 | 0.54 | 0.928 | 54.161 |
| P1 | 98.0 | 16.5 | 0.936 | 0.346 | 1.0 | 19.513 |
| P1+P2 | 98.0 | 39.8 | 0.476 | 0.426 | 0.972 | 47.071 |
| P1 | 99.0 | 9.0 | 0.943 | 0.19 | 1.0 | 10.625 |
| P1+P2 | 99.0 | 33.7 | 0.397 | 0.3 | 0.992 | 39.844 |
| P1 | 99.5 | 5.2 | 0.952 | 0.108 | 1.0 | 6.121 |
| P1+P2 | 99.5 | 30.6 | 0.339 | 0.233 | 1.0 | 36.164 |


# Recall by anomaly type (test windows pooled over seeds)

| method | anomaly_type | n_pos | caught | recall |
|---|---|---|---|---|
| P1 (ensemble p97) | bigram_violation | 66 | 2 | 0.03 |
| P1 (ensemble p97) | broad_access | 64 | 40 | 0.625 |
| P1 (ensemble p97) | consent_probe | 72 | 41 | 0.569 |
| P1 (ensemble p97) | cross_org_denied | 61 | 35 | 0.574 |
| P1 (ensemble p97) | dispense_without_read | 56 | 36 | 0.643 |
| P1 (ensemble p97) | off_hours_burst | 63 | 58 | 0.921 |
| P1 (ensemble p97) | order_composition | 62 | 1 | 0.016 |
| LSTM only (p99) | bigram_violation | 66 | 0 | 0.0 |
| LSTM only (p99) | broad_access | 64 | 9 | 0.141 |
| LSTM only (p99) | consent_probe | 72 | 27 | 0.375 |
| LSTM only (p99) | cross_org_denied | 61 | 17 | 0.279 |
| LSTM only (p99) | dispense_without_read | 56 | 7 | 0.125 |
| LSTM only (p99) | off_hours_burst | 63 | 7 | 0.111 |
| LSTM only (p99) | order_composition | 62 | 2 | 0.032 |
| DeepLog-style (budget-matched g) | bigram_violation | 66 | 1 | 0.015 |
| DeepLog-style (budget-matched g) | broad_access | 64 | 13 | 0.203 |
| DeepLog-style (budget-matched g) | consent_probe | 72 | 10 | 0.139 |
| DeepLog-style (budget-matched g) | cross_org_denied | 61 | 13 | 0.213 |
| DeepLog-style (budget-matched g) | dispense_without_read | 56 | 10 | 0.179 |
| DeepLog-style (budget-matched g) | off_hours_burst | 63 | 15 | 0.238 |
| DeepLog-style (budget-matched g) | order_composition | 62 | 3 | 0.048 |
| Deployed P1+P2 | bigram_violation | 66 | 2 | 0.03 |
| Deployed P1+P2 | broad_access | 64 | 40 | 0.625 |
| Deployed P1+P2 | consent_probe | 72 | 57 | 0.792 |
| Deployed P1+P2 | cross_org_denied | 61 | 43 | 0.705 |
| Deployed P1+P2 | dispense_without_read | 56 | 38 | 0.679 |
| Deployed P1+P2 | off_hours_burst | 63 | 59 | 0.937 |
| Deployed P1+P2 | order_composition | 62 | 3 | 0.048 |
| Supervised LR (train+val labels) | bigram_violation | 66 | 9 | 0.136 |
| Supervised LR (train+val labels) | broad_access | 64 | 64 | 1.0 |
| Supervised LR (train+val labels) | consent_probe | 72 | 72 | 1.0 |
| Supervised LR (train+val labels) | cross_org_denied | 61 | 61 | 1.0 |
| Supervised LR (train+val labels) | dispense_without_read | 56 | 56 | 1.0 |
| Supervised LR (train+val labels) | off_hours_burst | 63 | 61 | 0.968 |
| Supervised LR (train+val labels) | order_composition | 62 | 16 | 0.258 |
